import { createHash } from "node:crypto";
import path from "node:path";
import { versionedArtifactFileName } from "./durable-artifact-publisher.js";
import { listSessionAttachments, saveSessionAttachment } from "./session-attachment-store.js";
import { listSessionMessages, saveSessionMessage } from "./session-message-store.js";
import { listSessions } from "./session-store.js";
import type { SessionAttachmentRecord } from "./types.js";
import { nowIso } from "./utils.js";

const LEGACY_NAME_PATTERN = /^(?:generated-output|task-output)(?:_v[1-9]\d*)?(\.[^.]+)$/iu;

function generatedArtifact(attachment: SessionAttachmentRecord): boolean {
  return attachment.kind === "generated_output" && attachment.metadata?.source === "conversation_generated_output";
}

function cleanStem(value: unknown): string {
  const source = typeof value === "string" ? value.normalize("NFKC") : "";
  return source
    .replaceAll("\\", "/")
    .split("/").pop()!
    .replace(/\.[A-Za-z0-9]{1,12}$/u, "")
    .replace(/^#+\s*/u, "")
    .replace(/^(?:generated-output|task-output)(?:_v[1-9]\d*)?$/iu, "")
    .replace(/[<>:"|?*\u0000-\u001f]/gu, "-")
    .replace(/[，。,:：;；!?！？、/&+]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 72)
    .replace(/\s+/gu, "-");
}

function firstContentHeading(attachment: SessionAttachmentRecord): string {
  const content = typeof attachment.metadata?.generated_text_content === "string"
    ? attachment.metadata.generated_text_content
    : "";
  return cleanStem(content.split(/\r?\n/u).find((line) => line.trim()) || "");
}

function semanticLegacyName(sessionTitle: string, attachment: SessionAttachmentRecord): string {
  const extension = path.extname(attachment.name) || ".bin";
  const sourceStem = cleanStem(attachment.metadata?.source_name);
  const headingStem = firstContentHeading(attachment);
  const sessionStem = cleanStem(sessionTitle);
  const language = typeof attachment.metadata?.target_language_code === "string"
    ? cleanStem(attachment.metadata.target_language_code).toLocaleLowerCase()
    : "";
  let stem = sourceStem || headingStem || sessionStem || "task-output";
  if (sourceStem && language && !new RegExp(`(?:-|_|\\.)${language}$`, "iu").test(stem)) {
    stem = `${stem}-${language}`;
  }
  return `${stem}${extension.toLocaleLowerCase()}`;
}

function familyDigest(sessionId: string, basis: string): string {
  return `artifact-family:${createHash("sha256").update(`${sessionId}\n${basis}`).digest("hex").slice(0, 24)}`;
}

function familyBasis(attachment: SessionAttachmentRecord, semanticName: string): string {
  const sourceId = typeof attachment.metadata?.source_attachment_id === "string"
    ? attachment.metadata.source_attachment_id
    : "";
  const sourceName = cleanStem(attachment.metadata?.source_name).toLocaleLowerCase();
  const language = typeof attachment.metadata?.target_language_code === "string"
    ? attachment.metadata.target_language_code.toLocaleLowerCase()
    : "";
  const operation = typeof attachment.metadata?.operation === "string"
    ? attachment.metadata.operation.toLocaleLowerCase()
    : "";
  const sourceIdentity = sourceId || sourceName;
  const contentHint = !sourceIdentity ? firstContentHeading(attachment).toLocaleLowerCase() : "";
  const extension = path.extname(semanticName).toLocaleLowerCase();
  return [sourceIdentity, language, operation, extension, contentHint || (!sourceIdentity ? semanticName.toLocaleLowerCase() : "")]
    .join("|");
}

export interface ArtifactProductizationMigrationResult {
  scanned: number;
  renamed: number;
  family_repaired: number;
  messages_updated: number;
}

export function migrateLegacyConversationArtifacts(): ArtifactProductizationMigrationResult {
  const result: ArtifactProductizationMigrationResult = {
    scanned: 0,
    renamed: 0,
    family_repaired: 0,
    messages_updated: 0,
  };
  for (const session of listSessions()) {
    const attachments = listSessionAttachments(session.session_id);
    const generated = attachments.filter(generatedArtifact);
    const names = new Set(attachments.map((attachment) => attachment.name));
    const familyByAttachment = new Map<string, string>();
    const renamedByAttachment = new Map<string, string>();

    for (const attachment of generated) {
      result.scanned += 1;
      const originalName = attachment.name;
      if (LEGACY_NAME_PATTERN.test(originalName)) {
        names.delete(originalName);
        attachment.name = versionedArtifactFileName(
          semanticLegacyName(session.title, attachment),
          names,
        );
        names.add(attachment.name);
        renamedByAttachment.set(attachment.attachment_id, attachment.name);
        result.renamed += 1;
      }

      const sourceId = typeof attachment.metadata?.source_attachment_id === "string"
        ? attachment.metadata.source_attachment_id
        : "";
      const sourceFamily = sourceId ? familyByAttachment.get(sourceId) : null;
      const operation = String(attachment.metadata?.operation || "").toLocaleLowerCase();
      const sameExtensionAsSource = sourceId
        ? path.extname(attachments.find((item) => item.attachment_id === sourceId)?.name || "").toLocaleLowerCase() ===
          path.extname(attachment.name).toLocaleLowerCase()
        : false;
      const familyId = sourceFamily && operation === "modify" && sameExtensionAsSource
        ? sourceFamily
        : familyDigest(session.session_id, familyBasis(attachment, attachment.name));
      familyByAttachment.set(attachment.attachment_id, familyId);
      if (attachment.metadata?.artifact_family_id !== familyId || renamedByAttachment.has(attachment.attachment_id)) {
        attachment.metadata = {
          ...(attachment.metadata || {}),
          artifact_family_id: familyId,
          artifact_productization_migrated_at: nowIso(),
          ...(originalName !== attachment.name ? { legacy_artifact_name: originalName } : {}),
        };
        saveSessionAttachment(attachment);
        result.family_repaired += 1;
      }
    }

    const migratedById = new Map(generated.map((attachment) => [attachment.attachment_id, attachment]));
    const familyVersions = new Map<string, SessionAttachmentRecord[]>();
    for (const attachment of generated) {
      const familyId = familyByAttachment.get(attachment.attachment_id)!;
      familyVersions.set(familyId, [...(familyVersions.get(familyId) || []), attachment]);
    }
    for (const message of listSessionMessages(session.session_id)) {
      if (message.kind !== "artifact_card") continue;
      const artifactId = typeof message.content?.artifact_id === "string" ? message.content.artifact_id : "";
      const attachment = migratedById.get(artifactId);
      if (!attachment) continue;
      const familyId = familyByAttachment.get(artifactId)!;
      const version = (familyVersions.get(familyId) || []).findIndex((item) => item.attachment_id === artifactId) + 1;
      const nextContent = {
        ...message.content,
        name: attachment.name,
        artifact_family_id: familyId,
        version,
        has_previous_version: version > 1,
      };
      if (JSON.stringify(nextContent) === JSON.stringify(message.content)) continue;
      message.content = nextContent;
      saveSessionMessage(message);
      result.messages_updated += 1;
    }
  }
  return result;
}
