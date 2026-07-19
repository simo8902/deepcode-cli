/**
 * sbdt Prompt Improver — adapted from claude-code-prompt-improver.
 *
 * Declarative nudge engine: evaluates user prompts against a set of rules,
 * each injecting context only when its criteria match. Rules merge by priority.
 * Adding a nudge is adding a rule object to the array — no other changes.
 *
 * Adapted from the Python engine (engine.py + rules.py + nudge_builtins.py):
 * - Same bypass logic (*, /, # prefixes)
 * - Same criteria evaluation (match/exclude/non_slash/flags)
 * - Same priority merge with blank-line join
 * - Rules are deliberately narrow: normal concrete requests must add no prompt pressure.
 * - Nudge text adapted for sbdt's tool set (no subagents, no plan mode)
 */

export type NudgeCriteria = {
  match?: string[];
  exclude?: string[];
  non_slash?: boolean;
  flags?: ("ignorecase" | "multiline" | "dotall")[];
};

export type NudgeAction = {
  type: "inject_context";
  text: string[];
};

export type NudgeRule = {
  id: string;
  criteria?: NudgeCriteria;
  action?: NudgeAction;
  priority?: number;
};

// ─── nudge registry ───────────────────────────────────────────────────────
// Adapted for sbdt: no subagents, no plan mode, sbdt tool routing.

const NUDGES: NudgeRule[] = [
  {
    id: "approach-assessment",
    criteria: {
      match: ["\\b(migrate|redesign|rewrite|integrate|across (the|all)|multiple (modules|services|packages|files)|add .* (feature|support))\\b"],
      flags: ["ignorecase"],
      non_slash: true,
    },
    action: {
      type: "inject_context",
      text: [
        "This request signals a cross-cutting change. Map its blast radius before editing so the implementation plan is grounded.",
        "For codebase work: use Serena for symbol-level operations (find_symbol, replace_symbol_body), Codebase Memory for architecture and impact analysis, filesystem tools for file reads/writes, and ripgrep for text search.",
        "Match the tool to the job — don't read entire files when a symbol lookup suffices.",
        "If this is straightforward or a single step, just proceed.",
      ],
    },
    priority: 10,
  },
  {
    id: "output-readability",
    criteria: {
      match: ["\\b(report|comparison|breakdown|write[- ]?up|audit)\\b"],
      flags: ["ignorecase"],
      non_slash: true,
    },
    action: {
      type: "inject_context",
      text: [
        "This is a substantial written deliverable. Lead with the conclusion and use short sections, tables, or bullets instead of walls of prose.",
      ],
    },
    priority: 30,
  },
  {
    id: "ask-user-question",
    criteria: {
      match: ["\\b(which|should (i|we)|prefer|choose|choice|decide|decision|options?|recommend\\w*|better|versus|vs|trade-?offs?|pick)\\b"],
      flags: ["ignorecase"],
      non_slash: true,
    },
    action: {
      type: "inject_context",
      text: [
        "If carrying out this request means making a decision that is genuinely the user's (an ambiguous fork, a real tradeoff, missing requirements): ask with the AskUserQuestion tool rather than guessing or burying the choice in prose — concrete options with their tradeoffs let the user react and think critically.",
        "When you lack the context to frame those options well, research and explore first so the questions are specific and grounded, not generic.",
        "For minor or reversible choices, pick a sensible default, note it, and proceed — only interrupt for decisions that genuinely need the user.",
      ],
    },
    priority: 40,
  },
  {
    id: "complexity-assessment",
    criteria: {
      match: ["\\b(migrate|redesign|architecture|dependency graph|callers?|callees?|across (the|all)|multiple (modules|services|packages|files))\\b"],
      flags: ["ignorecase"],
      non_slash: true,
    },
    action: {
      type: "inject_context",
      text: [
        "This request has explicit architecture or multi-module scope. Gather only the context needed to map its blast radius before changing code.",
      ],
    },
    priority: 50,
  },
];

// ─── engine ───────────────────────────────────────────────────────────────

function compileFlags(flags?: string[]): string {
  if (!flags || flags.length === 0) return "";
  const map: Record<string, string> = {
    ignorecase: "i",
    multiline: "m",
    dotall: "s",
  };
  return flags.map((f) => map[f] ?? "").join("");
}

function isBypassed(prompt: string): boolean {
  const stripped = prompt.trimStart();
  return !stripped || stripped.startsWith("*") || stripped.startsWith("#");
}

function isSlashCommand(prompt: string): boolean {
  return prompt.trimStart().startsWith("/");
}

function evaluateCriteria(prompt: string, criteria: NudgeCriteria): boolean {
  const flags = compileFlags(criteria.flags);

  if (criteria.non_slash && isSlashCommand(prompt)) {
    return false;
  }

  if (criteria.match) {
    const matched = criteria.match.some((pattern) => {
      try {
        return new RegExp(pattern, flags).test(prompt);
      } catch {
        return false;
      }
    });
    if (!matched) return false;
  }

  if (criteria.exclude) {
    const excluded = criteria.exclude.some((pattern) => {
      try {
        return new RegExp(pattern, flags).test(prompt);
      } catch {
        return false;
      }
    });
    if (excluded) return false;
  }

  return true;
}

function renderAction(action: NudgeAction): string {
  return action.text.join("\n");
}

function fragmentFor(rule: NudgeRule, prompt: string): string | null {
  if (!rule.action) return null;

  if (rule.criteria) {
    if (isBypassed(prompt)) return null;
    if (!evaluateCriteria(prompt, rule.criteria)) return null;
  }

  return renderAction(rule.action);
}

/**
 * Evaluate all nudges against the user prompt and return merged context.
 * Returns null if no nudges fire.
 */
export function evaluateNudges(prompt: string): string | null {
  if (!prompt || !prompt.trim()) return null;

  const fragments: Array<{ priority: number; text: string }> = [];

  for (const rule of NUDGES) {
    try {
      const fragment = fragmentFor(rule, prompt);
      if (fragment) {
        fragments.push({
          priority: rule.priority ?? 100,
          text: fragment,
        });
      }
    } catch {
      // One bad rule must not suppress the others.
    }
  }

  if (fragments.length === 0) return null;

  fragments.sort((a, b) => a.priority - b.priority);
  return fragments.map((f) => f.text).join("\n\n");
}

/**
 * Detect whether a prompt is vague enough to warrant the prompt-improver
 * question flow. Used by session.ts to decide whether to call
 * maybeAskPromptImprovementQuestion.
 *
 * This replaces the old vague-prompt regex check.
 */
export function isVaguePrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || text.startsWith("/") || text.startsWith("#") || text.startsWith("*")) {
    return false;
  }

  const hasTaskSignal = /\b(?:add|build|change|create|debug|fix|implement|improve|investigate|make|optimize|remove|refactor|review|solve|update|write)\b/i.test(text);
  const hasSpecificContext = /```|["']|[A-Za-z]:[\\/]\b|\b\w+\.(?:c|cc|cpp|h|hpp|cs|js|jsx|ts|tsx|py|rs|go|java|json|yaml|yml)\b|\b(?:because|when|where|which|using|with|so that|returns?|error|exception|stack trace|expected|actual)\b/i.test(text);
  const vagueReference = /\b(?:this|it|that|the bug|the issue|the problem|things?)\b/i.test(text);

  const shortUnderspecifiedTask = text.length <= 140 && hasTaskSignal && !hasSpecificContext;
  const contextlessReference = text.length <= 80 && vagueReference && /\b(?:doesn'?t work|not working|broken|wrong|bad|better)\b/i.test(text);

  return shortUnderspecifiedTask || contextlessReference;
}
