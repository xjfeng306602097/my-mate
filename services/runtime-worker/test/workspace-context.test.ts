import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkerWorkspaceContext } from "../src/types.js";
import { runRuntimeWorkerJob } from "../src/worker-runtime.js";
import { materializeWorkspaceContext, workspaceContextPrompt } from "../src/workspace-context.js";
import { buildJob } from "./worker-runtime.test.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function context(relativePath = "docs/brief.md", content = "Use this runtime context.\n"): WorkerWorkspaceContext {
  const file = {
    attachment_id: "attachment-context",
    name: path.posix.basename(relativePath),
    relative_path: relativePath,
    mime_type: "text/markdown",
    size_bytes: Buffer.byteLength(content, "utf8"),
    content_sha256: sha256(content),
    content,
  };
  const identity = {
    schema_version: 1 as const,
    mode: "snapshot" as const,
    source_session_id: "session-context",
    created_at: "2026-07-13T10:00:00.000Z",
    total_size_bytes: file.size_bytes,
    files: [{
      attachment_id: file.attachment_id,
      name: file.name,
      relative_path: file.relative_path,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      content_sha256: file.content_sha256,
    }],
  };
  return {
    ...identity,
    manifest_sha256: sha256(JSON.stringify(identity)),
    files: [file],
  };
}

test("runtime worker materializes verified context and a content-free manifest", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-worker-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const job = buildJob();
  job.provision.env.MY_MATE_WORKSPACE = root;
  job.provision.workspace.context = context();

  const result = materializeWorkspaceContext(job);
  assert.ok(result);
  assert.equal(fs.readFileSync(path.join(result.root_path, "files", "docs", "brief.md"), "utf8"), "Use this runtime context.\n");
  const manifest = JSON.parse(fs.readFileSync(result.manifest_path, "utf8")) as Record<string, unknown>;
  assert.equal(JSON.stringify(manifest).includes("Use this runtime context"), false);
  assert.equal(job.provision.workspace.metadata.context_manifest_path, result.relative_manifest_path);
  assert.match(workspaceContextPrompt(job) || "", /read-only workspace context snapshots/u);
  assert.match(workspaceContextPrompt(job) || "", /docs\/brief\.md/u);
});

test("runtime worker rejects context path traversal before materialization", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-worker-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const job = buildJob();
  job.provision.env.MY_MATE_WORKSPACE = root;
  job.provision.workspace.context = context("../outside.txt", "blocked");
  assert.throws(() => materializeWorkspaceContext(job), /escapes the materialized root/u);
  assert.equal(fs.existsSync(path.join(root, "outside.txt")), false);
});

test("runtime worker rejects tampered context content", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-worker-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const job = buildJob();
  job.provision.env.MY_MATE_WORKSPACE = root;
  const tampered = context();
  tampered.files[0]!.content = "tampered";
  job.provision.workspace.context = tampered;
  assert.throws(() => materializeWorkspaceContext(job), /file size is invalid|integrity check failed/u);
});

test("runtime job evidence records the materialized context manifest without file contents", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-worker-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previousWorkspace = process.env.MY_MATE_WORKSPACE;
  process.env.MY_MATE_WORKSPACE = root;
  try {
    const job = buildJob();
    job.provision.env.MY_MATE_WORKSPACE = root;
    job.provision.workspace.context = context();
    const result = await runRuntimeWorkerJob(job);
    const promptEvidence = result.evidence.find((item) => item.kind === "prompt");
    const inline = promptEvidence?.inline_payload as Record<string, unknown>;
    const evidenceContext = inline.workspace_context as Record<string, unknown>;
    assert.equal(evidenceContext.file_count, 1);
    assert.match(String(evidenceContext.manifest_path), /\.my-mate\/context\//u);
    assert.equal(JSON.stringify(evidenceContext).includes("Use this runtime context"), false);
  } finally {
    if (previousWorkspace === undefined) delete process.env.MY_MATE_WORKSPACE;
    else process.env.MY_MATE_WORKSPACE = previousWorkspace;
  }
});
