import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyConversationArtifacts } from "../src/artifact-productization-migration.js";
import { createSessionAttachment, listSessionAttachments, saveSessionAttachment } from "../src/session-attachment-store.js";
import { createSessionMessage, listSessionMessages } from "../src/session-message-store.js";
import { createSession } from "../src/session-store.js";
import { resetTestRoot } from "./helpers.js";

test("legacy generated outputs gain semantic names and explicit version families", () => {
  resetTestRoot();
  const session = createSession({ title: "Quarterly files", initial_message: "Create reports" });
  const createLegacy = (name: string, sourceName: string, content: string) => {
    const attachment = createSessionAttachment({
      sessionId: session.session_id,
      request: {
        name,
        storage_uri: `/api/sessions/${session.session_id}/artifacts/pending/download`,
        kind: "generated_output",
        mime_type: "application/pdf",
        metadata: {
          source: "conversation_generated_output",
          source_name: sourceName,
          source_attachment_id: `source:${sourceName}`,
          operation: "transform",
          generated_text_content: content,
        },
      },
    });
    attachment.storage_uri = `/api/sessions/${session.session_id}/artifacts/${attachment.attachment_id}/download`;
    saveSessionAttachment(attachment);
    createSessionMessage({
      session_id: session.session_id,
      role: "system",
      kind: "artifact_card",
      content: { artifact_id: attachment.attachment_id, name, storage_uri: attachment.storage_uri },
    });
    return attachment;
  };

  const alpha = createLegacy("generated-output.pdf", "alpha.md", "# Alpha report");
  const alphaV1 = createLegacy("generated-output_v1.pdf", "alpha.md", "# Alpha report\nUpdated");
  const beta = createLegacy("task-output.pdf", "beta.md", "# Beta report");
  const originalUris = new Map([alpha, alphaV1, beta].map((item) => [item.attachment_id, item.storage_uri]));

  const result = migrateLegacyConversationArtifacts();
  assert.equal(result.renamed, 3);
  const migrated = listSessionAttachments(session.session_id).filter((item) => item.kind === "generated_output");
  assert.deepEqual(migrated.map((item) => item.name), ["alpha.pdf", "alpha_v1.pdf", "beta.pdf"]);
  assert.deepEqual(migrated.map((item) => item.attachment_id), [alpha.attachment_id, alphaV1.attachment_id, beta.attachment_id]);
  assert.equal(migrated.every((item) => item.storage_uri === originalUris.get(item.attachment_id)), true);
  assert.equal(migrated[0]?.metadata.artifact_family_id, migrated[1]?.metadata.artifact_family_id);
  assert.notEqual(migrated[0]?.metadata.artifact_family_id, migrated[2]?.metadata.artifact_family_id);
  assert.deepEqual(
    listSessionMessages(session.session_id).filter((message) => message.kind === "artifact_card").map((message) => message.content.name),
    ["alpha.pdf", "alpha_v1.pdf", "beta.pdf"],
  );

  const repeated = migrateLegacyConversationArtifacts();
  assert.equal(repeated.renamed, 0);
  assert.equal(repeated.family_repaired, 0);
});
