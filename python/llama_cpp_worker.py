import json
import re
import sys
import uuid
from typing import Any


def sanitize_unicode(value: Any) -> Any:
    if isinstance(value, str):
        # JSON permits lone UTF-16 surrogates, while the llama.cpp Python binding
        # encodes prompts as strict UTF-8. Replace only those invalid code units
        # so one malformed file/prompt character cannot abort an entire turn.
        return value.encode("utf-8", "surrogatepass").decode("utf-8", "replace")
    if isinstance(value, list):
        return [sanitize_unicode(item) for item in value]
    if isinstance(value, dict):
        return {sanitize_unicode(key): sanitize_unicode(item) for key, item in value.items()}
    return value


def hide_thinking_content(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    visible = re.sub(r"<think\b[^>]*>.*?</think\s*>\s*", "", value, flags=re.IGNORECASE | re.DOTALL)
    closing_tag = re.search(r"</think\s*>", visible, flags=re.IGNORECASE)
    if closing_tag:
        visible = visible[closing_tag.end():]
    return visible.lstrip()


def parse_tool_argument(value: str) -> Any:
    candidate = value.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return candidate


def extract_text_tool_calls(content: Any, tools: list[dict[str, Any]]) -> tuple[Any, list[dict[str, Any]]]:
    if not isinstance(content, str):
        return content, []

    allowed_names = {
        function.get("name")
        for tool in tools
        if isinstance(tool, dict)
        and isinstance((function := tool.get("function")), dict)
        and isinstance(function.get("name"), str)
    }
    tool_calls: list[dict[str, Any]] = []

    def replace(match: re.Match[str]) -> str:
        name = match.group("name")
        if name not in allowed_names:
            return match.group(0)
        arguments: dict[str, Any] = {}
        for parameter in re.finditer(
            r"<parameter=(?P<name>[A-Za-z_][A-Za-z0-9_]*)>\s*(?P<value>.*?)\s*</parameter\s*>",
            match.group("body"),
            flags=re.IGNORECASE | re.DOTALL,
        ):
            arguments[parameter.group("name")] = parse_tool_argument(parameter.group("value"))
        tool_calls.append({
            "id": f"call_{uuid.uuid4().hex}",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)},
        })
        return ""

    visible = re.sub(
        r"<tool_call\s*>\s*<function=(?P<name>[A-Za-z_][A-Za-z0-9_]*)>\s*(?P<body>.*?)\s*</function\s*>\s*</tool_call\s*>",
        replace,
        content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return visible.strip(), tool_calls


def resolve_kv_cache_type(value: Any, llama_cpp: Any, setting_name: str) -> Any:
    if value is None:
        return None
    type_name = str(value).strip().lower()
    constant_name = {"f16": "GGML_TYPE_F16", "q8_0": "GGML_TYPE_Q8_0"}.get(type_name)
    if constant_name is None:
        raise RuntimeError(f"nativeLlamaCpp.{setting_name} must be f16 or q8_0")
    cache_type = getattr(llama_cpp, constant_name, None)
    if cache_type is None:
        raise RuntimeError(f"llama-cpp-python does not expose {constant_name} for native KV cache")
    return cache_type


class Worker:
    def __init__(self) -> None:
        self.llm: Any = None
        self.session_id: str | None = None
        self.history: list[dict[str, Any]] = []
        self.tools: list[dict[str, Any]] = []
        self.generation: dict[str, Any] = {}
        self.model_key: str | None = None
        self.max_tokens: int | None = None

    def emit_progress(self, request_id: str, event: str, **payload: Any) -> None:
        sys.stdout.write(json.dumps({"id": request_id, "event": event, **payload}, default=str) + "\n")
        sys.stdout.flush()

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        request_id = request["id"]
        try:
            request_type = request["type"]
            if request_type == "init":
                self.emit_progress(request_id, "model_load_started", config=request.get("config", {}))
                self.initialize(request)
                self.emit_progress(
                    request_id,
                    "model_load_complete",
                    context_tokens=self.llm.n_ctx() if self.llm is not None else None,
                    initial_messages=len(self.history),
                    initial_payload_chars=len(json.dumps(self.history, default=str)),
                )
                return {"id": request_id, "ok": True}
            if request_type == "append":
                self.require_session(request)
                messages = request.get("messages", [])
                self.history.extend(messages)
                self.emit_progress(
                    request_id,
                    "context_appended",
                    messages=len(messages),
                    payload_chars=len(json.dumps(messages, default=str)),
                    history_messages=len(self.history),
                )
                return {"id": request_id, "ok": True}
            if request_type == "complete":
                self.require_session(request)
                self.emit_progress(
                    request_id,
                    "inference_started",
                    cached_tokens=self.llm.n_tokens if self.llm is not None else 0,
                    history_messages=len(self.history),
                )
                response = self.complete()
                self.emit_progress(
                    request_id,
                    "inference_complete",
                    cached_tokens=self.llm.n_tokens if self.llm is not None else 0,
                    usage=response.get("usage"),
                )
                return {
                    "id": request_id,
                    "ok": True,
                    "message": response["message"],
                    "usage": response.get("usage"),
                }
            if request_type == "reset":
                self.require_session(request)
                self.history = []
                if self.llm is not None:
                    self.llm.reset()
                return {"id": request_id, "ok": True}
            raise RuntimeError(f"Unknown request type: {request_type}")
        except Exception as error:
            return {"id": request_id, "ok": False, "error": str(error)}

    def initialize(self, request: dict[str, Any]) -> None:
        config = request["config"]
        model_path = str(config.get("modelPath") or "").strip()
        if not model_path:
            raise RuntimeError("nativeLlamaCpp.modelPath is required")
        model_key = json.dumps({
            "modelPath": model_path,
            "chatFormat": config.get("chatFormat"),
            "nCtx": config.get("nCtx"),
            "nGpuLayers": config.get("nGpuLayers"),
            "flashAttn": config.get("flashAttn"),
            "nBatch": config.get("nBatch"),
            "kvTypeK": config.get("kvTypeK"),
            "kvTypeV": config.get("kvTypeV"),
            "useMmap": config.get("useMmap"),
            "maxTokens": config.get("maxTokens"),
        }, sort_keys=True)
        if self.llm is None or self.model_key != model_key:
            try:
                from llama_cpp import Llama
                import llama_cpp.llama_cpp as llama_cpp
            except Exception as error:
                raise RuntimeError(
                    "Cannot import llama_cpp. Install llama-cpp-python in the configured Python environment."
                ) from error
            options: dict[str, Any] = {
                "model_path": model_path,
                "verbose": False,
                "flash_attn": config.get("flashAttn") is not False,
                "use_mmap": config.get("useMmap") is not False,
            }
            if isinstance(config.get("nCtx"), int) and config["nCtx"] > 0:
                options["n_ctx"] = config["nCtx"]
            if isinstance(config.get("nGpuLayers"), int):
                options["n_gpu_layers"] = config["nGpuLayers"]
            if isinstance(config.get("nBatch"), int) and config["nBatch"] > 0:
                options["n_batch"] = config["nBatch"]
            kv_type_k = resolve_kv_cache_type(config.get("kvTypeK"), llama_cpp, "kvTypeK")
            if kv_type_k is not None:
                options["type_k"] = kv_type_k
            kv_type_v = resolve_kv_cache_type(config.get("kvTypeV"), llama_cpp, "kvTypeV")
            if kv_type_v is not None:
                options["type_v"] = kv_type_v
            if isinstance(config.get("chatFormat"), str) and config["chatFormat"].strip():
                options["chat_format"] = config["chatFormat"].strip()
            self.llm = Llama(**options)
            self.model_key = model_key
        else:
            self.llm.reset()

        self.session_id = request["sessionId"]
        self.history = list(request.get("messages", []))
        self.tools = list(request.get("tools", []))
        self.generation = dict(request.get("generation", {}))
        self.max_tokens = config.get("maxTokens") if isinstance(config.get("maxTokens"), int) else None

    def require_session(self, request: dict[str, Any]) -> None:
        if self.llm is None or self.session_id != request.get("sessionId"):
            raise RuntimeError("Native llama.cpp session is not initialized")

    def complete(self) -> dict[str, Any]:
        options: dict[str, Any] = {
            "messages": self.history,
            "stream": False,
        }
        if self.tools:
            options["tools"] = self.tools
            options["tool_choice"] = "auto"
        if self.max_tokens is not None:
            options["max_tokens"] = self.max_tokens
        for source, target in (("temperature", "temperature"), ("topP", "top_p"), ("repetitionPenalty", "repeat_penalty")):
            value = self.generation.get(source)
            if isinstance(value, (int, float)):
                options[target] = value

        raw = self.llm.create_chat_completion(**options)
        choice = raw["choices"][0]["message"]
        history_message = dict(choice)
        self.history.append(history_message)
        message = dict(history_message)
        content, tool_calls = extract_text_tool_calls(hide_thinking_content(message.get("content")), self.tools)
        message["content"] = content
        if tool_calls:
            message["tool_calls"] = tool_calls
        return {"message": message, "usage": raw.get("usage")}


def main() -> None:
    worker = Worker()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = sanitize_unicode(json.loads(line))
            response = worker.handle(request)
        except Exception as error:
            response = {"id": None, "ok": False, "error": str(error)}
        sys.stdout.write(json.dumps(response, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
