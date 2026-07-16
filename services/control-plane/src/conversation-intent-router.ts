import type { ConversationIntentRoute } from "./types.js";

const INTENTS = new Set<ConversationIntentRoute["intent"]>([
  "capture_goal", "clarify", "ask_status", "add_constraint", "ask_draft",
  "ask_plan", "ask_revise", "ask_confirm", "ask_run",
]);

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function entities(text: string): ConversationIntentRoute["entities"] {
  const filename = /\b([\w.-]+\.(?:md|txt|json|csv|xlsx?|docx?|pdf|pptx?|py|java|ts|js|xml|ya?ml))\b/iu.exec(text)?.[1] || null;
  const parallelism = /(?:parallel(?:ism)?|concurrency|\u5e76\u884c|\u5e76\u53d1)\D{0,10}(\d{1,3})/iu.exec(text)?.[1] || null;
  const language = includesAny(normalized(text), ["\u4e2d\u6587", "chinese"])
    ? "zh"
    : includesAny(normalized(text), ["\u6cd5\u6587", "\u6cd5\u8bed", "french"])
      ? "fr"
      : includesAny(normalized(text), ["\u82f1\u6587", "\u82f1\u8bed", "english"])
        ? "en"
        : null;
  return {
    filename,
    target_language: language,
    parallelism: parallelism ? Number(parallelism) : null,
  };
}

function route(
  intent: ConversationIntentRoute["intent"],
  confidence: number,
  reason: string,
  text: string,
  directiveText: string | null = null,
): ConversationIntentRoute {
  const requiredCapability = intent === "ask_run"
    ? "runtime.execute"
    : intent === "ask_plan" || intent === "ask_draft" || intent === "ask_revise"
      ? "planner"
      : intent === "ask_status"
        ? "workspace.read"
        : null;
  return {
    schema_version: 1,
    intent,
    confidence,
    source: "deterministic",
    entities: entities(text),
    risk: intent === "ask_run" ? "medium" : "low",
    required_capability: requiredCapability,
    directive_text: directiveText,
    reason,
  };
}

export function routeConversationIntent(userText: string): ConversationIntentRoute {
  const text = normalized(userText);
  if (!text) return route("clarify", 1, "The message is empty.", userText);
  if (includesAny(text, [
    "what is the progress", "current status", "task status", "where are we", "what changed", "next best move",
    "\u8fdb\u5ea6", "\u73b0\u5728\u5230\u54ea\u4e86", "\u76ee\u524d\u600e\u4e48\u6837", "\u5f53\u524d\u4efb\u52a1\u72b6\u6001", "\u4e0b\u4e00\u6b65", "\u63a5\u4e0b\u6765\u600e\u4e48\u505a",
  ])) {
    return route("ask_status", 0.96, "Matched a task status or next-step request.", userText);
  }
  if (includesAny(text, [
    "draft dag", "draft workflow", "workflow draft", "generate dag draft", "dag draft",
    "\u8d77\u8349dag", "\u751f\u6210dag", "\u5de5\u4f5c\u6d41\u8349\u7a3f",
  ])) {
    return route("ask_draft", 0.97, "Matched an explicit workflow draft request.", userText);
  }
  if (includesAny(text, [
    "create plan", "make a plan", "plan this", "plan options", "compare plans",
    "\u751f\u6210\u65b9\u6848", "\u51fa\u65b9\u6848", "\u4e24\u5957\u65b9\u6848", "\u6bd4\u8f83\u65b9\u6848",
  ])) {
    return route("ask_plan", 0.97, "Matched an explicit planning request.", userText);
  }
  if (includesAny(text, [
    "run this", "run the plan", "start run", "execute now", "launch run",
    "\u76f4\u63a5\u6267\u884c", "\u5f00\u59cb\u6267\u884c", "\u5f00\u59cb\u8fd0\u884c",
  ])) {
    return route("ask_run", 0.98, "Matched an explicit execution request.", userText);
  }
  if (includesAny(text, [
    "confirm plan", "confirm this plan", "lock the plan",
    "\u786e\u8ba4\u65b9\u6848", "\u786e\u8ba4\u8fd9\u4e2a\u65b9\u6848", "\u9501\u5b9a\u65b9\u6848",
  ])) {
    return route("ask_confirm", 0.98, "Matched an explicit plan confirmation.", userText);
  }
  const revise = /(?:\b(?:revise|adjust|rework|modify|change)\b.{0,20}\b(?:plan|workflow|dag|route)\b|(?:\u4fee\u6539|\u8c03\u6574|\u4fee\u8ba2|\u91cd\u65b0\u89c4\u5212).{0,20}(?:\u65b9\u6848|\u8ba1\u5212|\u6d41\u7a0b))/iu.exec(userText);
  if (revise) return route("ask_revise", 0.95, "Matched a route revision instruction.", userText, userText.trim());
  const asksQuestion = /[?\uFF1F]\s*$/u.test(userText.trim()) || /^(?:what|which|how|why|when|where|who|can|could|should|is|are)\b/iu.test(text) || includesAny(text, ["\u600e\u4e48", "\u5982\u4f55", "\u4e3a\u4ec0\u4e48", "\u662f\u5426", "\u80fd\u4e0d\u80fd"]);
  if (asksQuestion) return route("clarify", 0.88, "Matched a question that does not directly mutate task state.", userText);
  const constraint = /(?:\b(?:must|should|need to|without|include|exclude|avoid|deadline|budget|concise|keep|add|also make|make this|surface|suitable|tighter|tone|top\s+\d+)\b|\u5fc5\u987b|\u5e94\u8be5|\u9700\u8981|\u4e0d\u8981|\u5305\u542b|\u6392\u9664|\u9884\u7b97|\u622a\u6b62|\u7b80\u6d01|\u7edf\u4e00|\u7ea6\u5b9a)/iu.test(userText);
  if (constraint) return route("add_constraint", 0.9, "Matched a task constraint or convention.", userText);
  const goal = /^(?:prepare|build|create|write|research|design|analyze|review|summarize|produce|generate|organize)\b/iu.test(text) || /^(?:\u5e2e\u6211|\u8bf7|\u51c6\u5907|\u521b\u5efa|\u751f\u6210|\u64b0\u5199|\u7814\u7a76|\u8bbe\u8ba1|\u5206\u6790|\u603b\u7ed3|\u6574\u7406)/u.test(userText.trim());
  if (goal || userText.trim().length > 160) return route("capture_goal", goal ? 0.9 : 0.72, "Matched an actionable outcome or substantial task brief.", userText);
  return route("clarify", 0.58, "No high-confidence task-state intent matched.", userText);
}

export function parseModelIntentRoute(value: string): ConversationIntentRoute | null {
  const match = /\{[\s\S]*\}/u.exec(value);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (!INTENTS.has(parsed.intent as ConversationIntentRoute["intent"])) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence) || confidence < 0.7 || confidence > 1) return null;
    const rawEntities = parsed.entities && typeof parsed.entities === "object" && !Array.isArray(parsed.entities)
      ? parsed.entities as Record<string, unknown>
      : {};
    const safeEntities = Object.fromEntries(Object.entries(rawEntities).flatMap(([key, item]) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null
        ? [[key.slice(0, 80), item]]
        : [],
    ));
    return {
      schema_version: 1,
      intent: parsed.intent as ConversationIntentRoute["intent"],
      confidence,
      source: "model",
      entities: safeEntities,
      risk: parsed.risk === "high" || parsed.risk === "medium" ? parsed.risk : "low",
      required_capability: typeof parsed.required_capability === "string" ? parsed.required_capability.slice(0, 160) : null,
      directive_text: typeof parsed.directive_text === "string" ? parsed.directive_text.slice(0, 2_000) : null,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "Model intent classification.",
    };
  } catch {
    return null;
  }
}
