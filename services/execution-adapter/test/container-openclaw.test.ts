import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyContainerAuthProbeFailure,
  extractAgentReport,
  extractReportFromTrajectoryEvents,
  hasMissingBedrockAuth,
  isExpiredAwsAuthMessage,
  parseAgentJson,
  parseProviderFromModelId,
  taskSnapshotFromJson,
} from "../src/container-openclaw.js";
import { materializeRequirementBundle } from "../src/openclaw-materialization.js";
import { createDispatchRecord, createDispatchRequest } from "./helpers.js";

test("parseAgentJson extracts JSON from mixed stdout", () => {
  const parsed = parseAgentJson("warning line\n{\"taskId\":\"abc\",\"status\":\"running\"}\n");
  assert.deepEqual(parsed, {
    taskId: "abc",
    status: "running",
  });
});

test("extractAgentReport returns report block", () => {
  const report = extractAgentReport("hello\n[AGENT_REPORT]\nstatus: done\nsummary: ok");
  assert.equal(report, "[AGENT_REPORT]\nstatus: done\nsummary: ok");
});

test("extractReportFromTrajectoryEvents falls back to assistant text in events", () => {
  const events = [
    JSON.stringify({
      data: {
        message: {
          content: [
            {
              type: "text",
              text: "some output",
            },
            {
              type: "text",
              text: "[AGENT_REPORT]\nstatus: failed\nsummary: compile failed",
            },
          ],
        },
      },
    }),
  ].join("\n");

  const report = extractReportFromTrajectoryEvents(events);
  assert.equal(report, "[AGENT_REPORT]\nstatus: failed\nsummary: compile failed");
});

test("extractReportFromTrajectoryEvents can recover from raw finalAssistantRawText", () => {
  const events = [
    JSON.stringify({
      finalAssistantRawText: "prefix\n[AGENT_REPORT]\nstatus: blocked\nsummary: waiting on approval",
    }),
  ].join("\n");

  const report = extractReportFromTrajectoryEvents(events);
  assert.equal(report, "[AGENT_REPORT]\nstatus: blocked\nsummary: waiting on approval");
});

test("taskSnapshotFromJson preserves task error details", () => {
  const snapshot = taskSnapshotFromJson({
    taskId: "task-1",
    runId: "run-1",
    requesterSessionKey: "session-a",
    childSessionKey: "session-b",
    agentId: "backend",
    status: "failed",
    terminalSummary: "high level summary",
    error: "Token is expired.",
  });

  assert.deepEqual(snapshot, {
    taskId: "task-1",
    runId: "run-1",
    requesterSessionKey: "session-a",
    childSessionKey: "session-b",
    agentId: "backend",
    status: "failed",
    terminalSummary: "high level summary",
    error: "Token is expired.",
  });
});

test("isExpiredAwsAuthMessage matches common AWS SSO expiry output", () => {
  assert.equal(
    isExpiredAwsAuthMessage("Error when retrieving token from sso: Token has expired and refresh failed"),
    true,
  );
  assert.equal(
    isExpiredAwsAuthMessage("Token is expired. To refresh this SSO session run 'aws sso login'."),
    true,
  );
  assert.equal(isExpiredAwsAuthMessage("some unrelated failure"), false);
});

test("classifyContainerAuthProbeFailure marks expired SSO as auth expired", () => {
  const error = classifyContainerAuthProbeFailure(
    "Error when retrieving token from sso: Token has expired and refresh failed",
  );

  assert.equal(error.code, "OPENCLAW_CONTAINER_AWS_AUTH_EXPIRED");
  assert.match(error.message, /credentials are expired/i);
});

test("classifyContainerAuthProbeFailure preserves generic auth probe failure", () => {
  const error = classifyContainerAuthProbeFailure("aws: command not found");

  assert.equal(error.code, "OPENCLAW_CONTAINER_AWS_AUTH_FAILED");
  assert.match(error.message, /authentication probe failed/i);
});

test("hasMissingBedrockAuth detects missing amazon-bedrock auth from models status", () => {
  const text = [
    "Auth overview",
    "Missing auth",
    "- amazon-bedrock `openclaw configure` or set an API key env var.",
  ].join("\n");

  assert.equal(hasMissingBedrockAuth(text), true);
  assert.equal(hasMissingBedrockAuth("all providers ready"), false);
});

test("parseProviderFromModelId extracts provider prefix", () => {
  assert.equal(parseProviderFromModelId("amazon-bedrock/us.anthropic.claude-opus-4-7"), "amazon-bedrock");
  assert.equal(parseProviderFromModelId("deepseek/deepseek-v4-pro"), "deepseek");
  assert.equal(parseProviderFromModelId("gpt-5.5"), null);
  assert.equal(parseProviderFromModelId(null), null);
});

test("materializeRequirementBundle writes actionable TECH_DESIGN from upstream context when intent is damaged", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-openclaw-"));
  const record = createDispatchRecord({
    dispatch_id: "disp_test_report_001",
    node_id: "node_report",
    node_name: "Compose Report",
    request_snapshot: {
      ...createDispatchRequest(),
      node_id: "node_report",
      node_name: "Compose Report",
      intent: "?????????,?????????????,???????,???????? summary ? report?",
      output_contract: {
        expected_artifacts: ["research-report"],
      },
      input_payload: {
        title: "Compose Report",
        run_inputs: {
          goal: "?????????,?????????????,????????",
        },
        upstream_context: {
          nodes: [
            {
              node_run_id: "nr_upstream_001",
              node_id: "node_research",
              node_name: "Gather Research",
              status: "completed",
              summary: "Collected competitor notes and prepared research summary.",
              artifacts: [
                {
                  artifact_id: "artifact_upstream_001",
                  type: "summary",
                  name: "research-summary.txt",
                  storage_uri: "bridge://dispatches/disp_upstream/research-summary",
                  mime_type: "text/plain",
                  size_bytes: 1234,
                },
              ],
            },
          ],
        },
      },
    },
  });

  try {
    const bundle = materializeRequirementBundle({
      record,
      localRequirementsRoot: path.join(tempRoot, "requirements"),
      runtimeRequirementsRoot: "/runtime/requirements",
      runtimePathJoin: (...segments: string[]) => path.posix.join(...segments),
    });

    const techDesign = fs.readFileSync(bundle.hostTechDesignPath, "utf-8");
    assert.match(
      techDesign,
      /Compose a final report from the completed upstream research context and artifacts\./,
    );
    assert.match(techDesign, /## Upstream Context/);
    assert.match(techDesign, /Collected competitor notes and prepared research summary\./);
    assert.match(techDesign, /research-summary\.txt \[summary\]/);
    assert.match(techDesign, /Produce artifact\(s\): research-report/);

    const yaml = fs.readFileSync(bundle.hostStatePath, "utf-8");
    assert.match(yaml, /AC-1: When the node finishes, it produces the expected artifact set: research-report\./);
    assert.match(yaml, /AC-2: The report synthesizes upstream research findings into a readable final deliverable with clear sections\./);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
