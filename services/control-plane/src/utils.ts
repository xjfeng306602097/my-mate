import fs from "node:fs";
import path from "node:path";

let lastGeneratedAtMs = 0;
let lastGeneratedSequence = 0;

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function nowIso(): string {
  return new Date().toISOString();
}

function nextSortableIdSeed(): { stamp: string; sequence: string } {
  const nowMs = Date.now();
  if (nowMs === lastGeneratedAtMs) {
    lastGeneratedSequence += 1;
  } else {
    lastGeneratedAtMs = nowMs;
    lastGeneratedSequence = 0;
  }

  const stamp = new Date(nowMs)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d{3})Z$/, "$1Z");

  return {
    stamp,
    sequence: String(lastGeneratedSequence).padStart(3, "0"),
  };
}

export function generateRunId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `run_${stamp}_${sequence}_${suffix}`;
}

export function generateEventId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `evt_${stamp}_${sequence}_${suffix}`;
}

export function generateArtifactId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `art_${stamp}_${sequence}_${suffix}`;
}

export function generateSessionAttachmentId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `att_${stamp}_${sequence}_${suffix}`;
}

export function generateApprovalId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `apr_${stamp}_${sequence}_${suffix}`;
}

export function generateHumanInputId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `hir_${stamp}_${sequence}_${suffix}`;
}

export function generateSessionId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `sess_${stamp}_${sequence}_${suffix}`;
}

export function generateSessionMessageId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `msg_${stamp}_${sequence}_${suffix}`;
}

export function generateSessionInterventionId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `int_${stamp}_${sequence}_${suffix}`;
}

export function generateDagPatchId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `patch_${stamp}_${sequence}_${suffix}`;
}

export function generateDagProposalId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `prop_${stamp}_${sequence}_${suffix}`;
}

export function generateNodeRunId(nodeId: string): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  const nodeSlug = slugify(nodeId) || "node";
  return `nr_${nodeSlug}_${stamp}_${sequence}_${suffix}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  fs.renameSync(tempPath, filePath);
}
