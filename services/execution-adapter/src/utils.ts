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

export function generateDispatchId(): string {
  const { stamp, sequence } = nextSortableIdSeed();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `disp_${stamp}_${sequence}_${suffix}`;
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSummaryText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/\r\n/g, "\n")
    .replace(/\u2014|\u2015/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/\u00a0/g, " ");
}
