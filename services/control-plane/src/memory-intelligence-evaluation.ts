import { routeConversationIntent } from "./conversation-intent-router.js";
import { resolveMemoryOperation } from "./memory-intelligence.js";
import type {
  ConversationIntentEvaluationResult,
  ConversationIntentRoute,
  MemoryIntelligenceOperation,
} from "./types.js";
import { nowIso } from "./utils.js";

type Intent = ConversationIntentRoute["intent"];

interface IntentFixture {
  id: string;
  input: string;
  expected: Intent;
}

const FIXTURES: IntentFixture[] = [
  { id: "goal-build", input: "Build a release readiness report with validation evidence.", expected: "capture_goal" },
  { id: "goal-research", input: "Research the available browser automation approaches.", expected: "capture_goal" },
  { id: "status", input: "What is the current task status?", expected: "ask_status" },
  { id: "draft", input: "Create a workflow draft for this task.", expected: "ask_draft" },
  { id: "plan", input: "Make a plan and compare two options.", expected: "ask_plan" },
  { id: "revise", input: "Revise the workflow to run the tests before packaging.", expected: "ask_revise" },
  { id: "confirm", input: "Confirm this plan.", expected: "ask_confirm" },
  { id: "run", input: "Run the plan now.", expected: "ask_run" },
  { id: "constraint", input: "The result must include tests and should avoid production changes.", expected: "add_constraint" },
  { id: "constraint-keep", input: "Keep the tone candid and list the main risks.", expected: "add_constraint" },
  { id: "constraint-add", input: "Add a review checkpoint before final delivery and keep the output practical.", expected: "add_constraint" },
  { id: "constraint-followup", input: "Also make this suitable for VP review and keep the delivery tighter.", expected: "add_constraint" },
  { id: "question", input: "Which provider should we use?", expected: "clarify" },
  { id: "zh-status", input: "\u5f53\u524d\u4efb\u52a1\u72b6\u6001\u600e\u4e48\u6837\uff1f", expected: "ask_status" },
  { id: "zh-plan", input: "\u5e2e\u6211\u751f\u6210\u65b9\u6848\uff0c\u5e76\u6bd4\u8f83\u4e24\u5957\u65b9\u6848", expected: "ask_plan" },
  { id: "zh-run", input: "\u76f4\u63a5\u6267\u884c", expected: "ask_run" },
  { id: "zh-confirm", input: "\u786e\u8ba4\u8fd9\u4e2a\u65b9\u6848", expected: "ask_confirm" },
  { id: "zh-constraint", input: "\u5fc5\u987b\u5305\u542b\u6d4b\u8bd5\u8bc1\u636e", expected: "add_constraint" },
  { id: "status-progress", input: "Where are we with this task?", expected: "ask_status" },
  { id: "draft-dag", input: "Draft DAG for the approved route.", expected: "ask_draft" },
  { id: "plan-compare", input: "Compare plans for the migration.", expected: "ask_plan" },
  { id: "revise-adjust", input: "Adjust the workflow to validate before publishing.", expected: "ask_revise" },
  { id: "confirm-lock", input: "Lock the plan.", expected: "ask_confirm" },
  { id: "run-execute", input: "Execute now.", expected: "ask_run" },
  { id: "constraint-avoid", input: "Avoid production changes and include rollback evidence.", expected: "add_constraint" },
  { id: "question-how", input: "How should we validate this?", expected: "clarify" },
  { id: "goal-design", input: "Design a safer deployment workflow.", expected: "capture_goal" },
  { id: "zh-status-next", input: "\u4e0b\u4e00\u6b65\u8981\u505a\u4ec0\u4e48", expected: "ask_status" },
  { id: "zh-draft-dag", input: "\u751f\u6210DAG\u8349\u7a3f", expected: "ask_draft" },
  { id: "zh-plan-option", input: "\u51fa\u65b9\u6848\u5e76\u8bf4\u660e\u53d6\u820d", expected: "ask_plan" },
  { id: "zh-revise-flow", input: "\u8c03\u6574\u6d41\u7a0b\uff0c\u5148\u9a8c\u8bc1\u518d\u53d1\u5e03", expected: "ask_revise" },
  { id: "zh-confirm-lock", input: "\u9501\u5b9a\u65b9\u6848", expected: "ask_confirm" },
  { id: "zh-run-start", input: "\u5f00\u59cb\u6267\u884c", expected: "ask_run" },
  { id: "zh-constraint-avoid", input: "\u4e0d\u8981\u4fee\u6539\u751f\u4ea7\u73af\u5883", expected: "add_constraint" },
  { id: "zh-question-why", input: "\u4e3a\u4ec0\u4e48\u9700\u8981\u8fd9\u4e2a\u6b65\u9aa4\uff1f", expected: "clarify" },
  { id: "zh-goal-design", input: "\u8bbe\u8ba1\u4e00\u4e2a\u66f4\u5b89\u5168\u7684\u53d1\u5e03\u6d41\u7a0b", expected: "capture_goal" },
];

interface OperationFixture {
  id: string;
  requestedOperation: string;
  targetExists: boolean;
  similarity?: number;
  expected: MemoryIntelligenceOperation;
}

const OPERATION_FIXTURES: OperationFixture[] = [
  { id: "create-new", requestedOperation: "create", targetExists: false, similarity: 0.1, expected: "create" },
  { id: "create-duplicate", requestedOperation: "create", targetExists: true, similarity: 1, expected: "ignore" },
  { id: "create-consolidate", requestedOperation: "create", targetExists: true, similarity: 0.78, expected: "update" },
  { id: "update-existing", requestedOperation: "update", targetExists: true, expected: "update" },
  { id: "supersede-existing", requestedOperation: "supersede", targetExists: true, expected: "supersede" },
  { id: "delete-existing", requestedOperation: "delete", targetExists: true, expected: "delete" },
  { id: "missing-update-target", requestedOperation: "update", targetExists: false, expected: "ignore" },
  { id: "invalid-operation", requestedOperation: "archive", targetExists: true, expected: "ignore" },
];

export function evaluateConversationIntentRouter(): ConversationIntentEvaluationResult {
  const cases = FIXTURES.map((fixture) => {
    const actual = routeConversationIntent(fixture.input);
    return {
      fixture_id: fixture.id,
      expected_intent: fixture.expected,
      actual_intent: actual.intent,
      confidence: actual.confidence,
      passed: actual.intent === fixture.expected,
    };
  });
  const intents = [...new Set(FIXTURES.map((fixture) => fixture.expected))];
  const perIntent = intents.map((intent) => {
    const matching = cases.filter((item) => item.expected_intent === intent);
    const passed = matching.filter((item) => item.passed).length;
    return {
      intent,
      total: matching.length,
      passed,
      accuracy: matching.length ? passed / matching.length : 0,
    };
  });
  const passed = cases.filter((item) => item.passed).length;
  const operationCases = OPERATION_FIXTURES.map((fixture) => {
    const actual = resolveMemoryOperation({
      requestedOperation: fixture.requestedOperation,
      targetExists: fixture.targetExists,
      similarity: fixture.similarity,
    });
    return {
      fixture_id: fixture.id,
      expected_operation: fixture.expected,
      actual_operation: actual,
      passed: actual === fixture.expected,
    };
  });
  const operationPassed = operationCases.filter((item) => item.passed).length;
  const operations = [...new Set(OPERATION_FIXTURES.map((fixture) => fixture.expected))];
  return {
    schema_version: 1,
    suite: "m8-memory-intelligence-v2",
    total: cases.length,
    passed,
    accuracy: cases.length ? passed / cases.length : 0,
    average_confidence: cases.length
      ? cases.reduce((total, item) => total + item.confidence, 0) / cases.length
      : 0,
    per_intent: perIntent,
    cases,
    memory_operations: {
      total: operationCases.length,
      passed: operationPassed,
      accuracy: operationCases.length ? operationPassed / operationCases.length : 0,
      per_operation: operations.map((operation) => {
        const matching = operationCases.filter((item) => item.expected_operation === operation);
        const matchingPassed = matching.filter((item) => item.passed).length;
        return {
          operation,
          total: matching.length,
          passed: matchingPassed,
          accuracy: matching.length ? matchingPassed / matching.length : 0,
        };
      }),
      cases: operationCases,
    },
    evaluated_at: nowIso(),
  };
}
