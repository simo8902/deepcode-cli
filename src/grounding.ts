export type GroundingActionIntent = "conversation" | "investigation" | "change" | "unknown";

export type GroundingContract = {
  version: 1;
  turnId: string;
  request: string;
  latestUserInput: string;
  actionIntent: GroundingActionIntent;
  explicitConstraints: string[];
  explicitNonGoals: string[];
  userCorrections: string[];
  knownUserFacts: string[];
  unresolvedQuestions: string[];
  persistentMemoryWriteAuthorized: boolean;
  architectureMappingRequired: boolean;
  sideEffectConfirmationRequired: boolean;
  createdAt: string;
};

const TASK_SIGNAL = /\b(?:add|apply|build|change|create|delete|debug|diagnose|edit|fix|implement|investigate|map|modify|move|remove|rename|refactor|review|update|write|convert|run|execute)\b/i;
const INVESTIGATION_SIGNAL = /\b(?:why|where|which|find|inspect|trace|review|diagnose|explain|check|show|list)\b/i;
const CHANGE_SIGNAL = /\b(?:add|apply|build|change|create|delete|edit|fix|implement|map|modify|move|remove|rename|refactor|update|write|convert|run|execute)\b/i;
const CONSTRAINT_SIGNAL = /\b(?:must|need(?:s)? to|should|keep|only|just|don't|do not|never|without|instead|focus on|already|have|has|okay|fine|separately|directly)\b/i;
const CORRECTION_SIGNAL = /\b(?:nope|no|wrong|misunderstood|misread|not that|i meant|i mean|keep\b|don't|do not|already|told|gave|focus on|instead)\b/i;
const ANSWER_PREFIX = /^\s*user has answered your questions:/i;
const APPROVAL_SIGNAL = /\b(?:yes|yep|yeah|proceed|go ahead|do it|apply|confirm|approved|ship|continue|execute)\b/i;
const DECLINE_SIGNAL = /\b(?:no|nope|don't|do not|cancel|stop|decline|not now|abort)\b/i;
const MEMORY_WRITE_SIGNAL = /\b(?:remember|memorize|save this|store this|keep this in memory|don't forget)\b/i;
const CPP_LANGUAGE_SIGNAL = /(?:\bc\+\+(?=\s|$|[.,:;!?])|\bcpp\b|\bcxx\b|\.(?:cpp|cc|cxx|hpp|h)\b|\bcmake(?:lists)?\b)/i;
const ARCHITECTURE_MAPPING_INTENT_SIGNAL = /(?:\barchitecture\b|\bdependency graph\b|\bcallers?\b|\bcallees?\b|\bimpact(?: analysis)?\b|\bmap(?:ping)?\b)/i;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitLiteralUnits(value: string): string[] {
  return value
    .split(/\r?\n+|(?<=[.!?])\s+/u)
    .map(normalizeText)
    .filter(Boolean);
}

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized.slice(0, 700));
    if (result.length >= limit) break;
  }
  return result;
}

function getActionIntent(text: string): GroundingActionIntent {
  if (!TASK_SIGNAL.test(text)) return "conversation";
  if (CHANGE_SIGNAL.test(text)) return "change";
  if (INVESTIGATION_SIGNAL.test(text)) return "investigation";
  return "unknown";
}

function getConstraintLines(text: string): string[] {
  return splitLiteralUnits(text).filter((unit) => CONSTRAINT_SIGNAL.test(unit));
}

function getCorrectionLines(text: string): string[] {
  return splitLiteralUnits(text).filter((unit) => CORRECTION_SIGNAL.test(unit));
}

function getUnresolvedQuestions(
  latestUserInput: string,
  priorUserMessages: string[],
  actionIntent: GroundingActionIntent
): string[] {
  if (actionIntent === "conversation" || actionIntent === "investigation") return [];
  if (priorUserMessages.length > 0) return [];

  const normalized = normalizeText(latestUserInput);
  const hasConcreteReference = /(?:[A-Za-z]:[\\/]|[./\\]|\b\w+\.(?:cpp|cc|cxx|h|hpp|ts|tsx|js|json|yaml|yml|py|rs|go|md)\b|```|\b(?:repo|repository|project|file|folder|function|class|module|tool|engine)\b)/i.test(normalized);
  if (normalized.length <= 140 && !hasConcreteReference) {
    return ["The request does not identify a concrete target or artifact yet."];
  }
  return [];
}

export function buildGroundingContract(
  turnId: string,
  latestUserInput: string,
  priorUserMessages: string[] = [],
  previous?: GroundingContract | null,
  sideEffectConfirmationRequired: boolean = process.env.SBDT_CONFIRM_SIDE_EFFECTS === "true"
): GroundingContract {
  const latest = normalizeText(latestUserInput);
  const prior = priorUserMessages.map(normalizeText).filter(Boolean).slice(-12);
  const currentIntent = getActionIntent(latest);
  const isAnswer = ANSWER_PREFIX.test(latest) || (latest.length <= 80 && APPROVAL_SIGNAL.test(latest) && !DECLINE_SIGNAL.test(latest));
  const request = isAnswer && previous ? previous.request : latest;
  const actionIntent = isAnswer && previous ? previous.actionIntent : currentIntent;
  const allText = [...prior, latest];

  return {
    version: 1,
    turnId,
    request: request.slice(0, 2000),
    latestUserInput: latest.slice(0, 2000),
    actionIntent,
    explicitConstraints: unique(allText.flatMap(getConstraintLines), 24),
    explicitNonGoals: unique(
      allText.flatMap((text) => splitLiteralUnits(text).filter((unit) => /\b(?:don't|do not|never|not|no|instead|keep .* separate|ignore|skip|just)\b/i.test(unit))),
      24
    ),
    userCorrections: unique(allText.flatMap(getCorrectionLines), 16),
    knownUserFacts: unique(prior, 12),
    unresolvedQuestions: getUnresolvedQuestions(latest, prior, actionIntent),
    persistentMemoryWriteAuthorized: MEMORY_WRITE_SIGNAL.test(latest),
    architectureMappingRequired: isAnswer && previous
      ? previous.architectureMappingRequired
      : requiresArchitectureMapping(latest),
    sideEffectConfirmationRequired,
    createdAt: new Date().toISOString()
  };
}

export function mergeGroundingContract(
  previous: GroundingContract | null | undefined,
  next: GroundingContract
): GroundingContract {
  if (!previous) return next;
  const isAnswer = ANSWER_PREFIX.test(next.latestUserInput) ||
    (next.latestUserInput.length <= 80 && APPROVAL_SIGNAL.test(next.latestUserInput) && !DECLINE_SIGNAL.test(next.latestUserInput));
  if (!isAnswer) return next;

  return {
    ...next,
    request: previous.request,
    actionIntent: previous.actionIntent,
    explicitConstraints: unique([...previous.explicitConstraints, ...next.explicitConstraints], 24),
    explicitNonGoals: unique([...previous.explicitNonGoals, ...next.explicitNonGoals], 24),
    userCorrections: unique([...previous.userCorrections, ...next.userCorrections], 16),
    knownUserFacts: unique([...previous.knownUserFacts, ...next.knownUserFacts], 12),
    unresolvedQuestions: previous.unresolvedQuestions,
    persistentMemoryWriteAuthorized: next.persistentMemoryWriteAuthorized,
    architectureMappingRequired: next.architectureMappingRequired
  };
}

export function isApprovalResponse(text: string): boolean {
  const normalized = normalizeText(text);
  return Boolean(normalized) && !DECLINE_SIGNAL.test(normalized) && APPROVAL_SIGNAL.test(normalized);
}

export function buildGroundingPrompt(contract: GroundingContract): string {
  const payload = {
    request: contract.request,
    latestUserInput: contract.latestUserInput,
    actionIntent: contract.actionIntent,
    explicitConstraints: contract.explicitConstraints,
    explicitNonGoals: contract.explicitNonGoals,
    userCorrections: contract.userCorrections,
    knownUserFacts: contract.knownUserFacts,
    unresolvedQuestions: contract.unresolvedQuestions,
    persistentMemoryWriteAuthorized: contract.persistentMemoryWriteAuthorized,
    architectureMappingRequired: contract.architectureMappingRequired,
    sideEffectConfirmationRequired: contract.sideEffectConfirmationRequired
  };

  return [
    "<sbdt-grounding-contract>",
    "This is host-generated working context for this turn. It is lower priority than host policy, project instructions, selected skills, and the user request.",
    "Do not replace a named format, path, file type, count, or non-goal with a nearby pattern from memory.",
    "Do not ask for information already present in knownUserFacts or explicitConstraints.",
    "If a required value is absent and cannot be discovered from the project, ask one concrete question before acting.",
    ...(contract.sideEffectConfirmationRequired
      ? ["Do not perform side-effecting tools until the host confirmation gate has approved the exact action."]
      : []),
    "Never claim an action is complete unless the tool result contains host verification with verified=true.",
    JSON.stringify(payload, null, 2),
    "</sbdt-grounding-contract>"
  ].join("\n");
}

export function requiresArchitectureMapping(text: string): boolean {
  return CPP_LANGUAGE_SIGNAL.test(text) && ARCHITECTURE_MAPPING_INTENT_SIGNAL.test(text);
}
