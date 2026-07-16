import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkspaceContextSnapshot,
  MAX_RUNTIME_CONTEXT_FILE_BYTES,
} from "../src/runtime/workspace-context-snapshot.js";
import type { SessionAttachmentRecord } from "../src/types.js";

function attachment(input: {
  id: string;
  path: string;
  content: string;
  source?: string;
  contentField?: "desktop_text_content" | "uploaded_text_content" | "generated_text_content" | "none";
}): SessionAttachmentRecord {
  const contentField = input.contentField || "desktop_text_content";
  return {
    attachment_id: input.id,
    session_id: "session-context",
    name: input.path.split("/").at(-1) || input.path,
    storage_uri: `file:///workspace/${input.path}`,
    mime_type: "text/plain",
    size_bytes: Buffer.byteLength(input.content, "utf8"),
    kind: "context",
    summary: null,
    created_by: "studio-desktop",
    created_at: `2026-07-13T00:00:0${input.id.at(-1)}.000Z`,
    metadata: {
      source: input.source || "desktop_workspace",
      relative_path: input.path,
      ...(contentField === "none" ? {} : { [contentField]: input.content }),
    },
  };
}

test("workspace context snapshot includes bounded desktop attachments with hashes", () => {
  const snapshot = buildWorkspaceContextSnapshot({
    sessionId: "session-context",
    createdAt: "2026-07-13T10:00:00.000Z",
    attachments: [
      attachment({ id: "att-1", path: "docs/brief.md", content: "first" }),
      attachment({ id: "att-2", path: "src/input.txt", content: "runtime context" }),
      attachment({ id: "att-3", path: "docs/brief.md", content: "latest" }),
      attachment({ id: "att-4", path: "ignored.txt", content: "browser", source: "studio_file_picker", contentField: "none" }),
    ],
  });

  assert.ok(snapshot);
  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.mode, "snapshot");
  assert.equal(snapshot.files.length, 2);
  assert.equal(snapshot.files[0]?.content, "runtime context");
  assert.equal(snapshot.files[1]?.content, "latest");
  assert.match(snapshot.files[0]?.content_sha256 || "", /^[a-f0-9]{64}$/u);
  assert.match(snapshot.manifest_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(snapshot.total_size_bytes, Buffer.byteLength("runtime contextlatest", "utf8"));
});

test("workspace context snapshot includes uploaded and generated text files", () => {
  const snapshot = buildWorkspaceContextSnapshot({
    sessionId: "session-context",
    attachments: [
      attachment({ id: "att-1", path: "input.xml", content: "<root/>", contentField: "uploaded_text_content" }),
      attachment({ id: "att-2", path: "Main.java", content: "public class Main {}", contentField: "generated_text_content" }),
    ],
  });
  assert.ok(snapshot);
  assert.deepEqual(snapshot.files.map((file) => file.relative_path), ["input.xml", "Main.java"]);
});

test("workspace context snapshot rejects unsafe and oversized attachment payloads", () => {
  const snapshot = buildWorkspaceContextSnapshot({
    sessionId: "session-context",
    attachments: [
      attachment({ id: "att-1", path: "../secret.txt", content: "secret" }),
      attachment({ id: "att-2", path: "C:/secret.txt", content: "secret" }),
      attachment({ id: "att-3", path: "large.txt", content: "x".repeat(MAX_RUNTIME_CONTEXT_FILE_BYTES + 1) }),
    ],
  });
  assert.equal(snapshot, null);
});
