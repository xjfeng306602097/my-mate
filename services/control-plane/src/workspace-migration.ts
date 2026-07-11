import {
  AGENT_PROFILES_DIR,
  ORCHESTRATOR_PROFILES_DIR,
  RUNS_DIR,
  SESSIONS_DIR,
  SKILLS_DIR,
  TEMPLATES_DIR,
} from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import { ensureWorkspace } from "./workspace-store.js";

export interface WorkspaceMigrationResult {
  scanned: number;
  migrated: number;
}

export function migrateLegacyWorkspaceRecords(): WorkspaceMigrationResult {
  const storage = getJsonStorageBackend();
  ensureWorkspace({ workspaceId: "default", name: "Default", createdBy: "system" });
  const targets = [
    { dir: RUNS_DIR, field: "workspace_id" },
    { dir: SESSIONS_DIR, field: "workspace_id" },
    { dir: AGENT_PROFILES_DIR, field: "workspace_id" },
    { dir: SKILLS_DIR, field: "workspace_id" },
    { dir: ORCHESTRATOR_PROFILES_DIR, field: "workspace_id" },
    { dir: TEMPLATES_DIR, field: "workspace_scope" },
  ] as const;
  let scanned = 0;
  let migrated = 0;
  for (const target of targets) {
    for (const filePath of storage.listJsonFiles(target.dir)) {
      scanned += 1;
      const record = storage.readJson<Record<string, unknown>>(filePath);
      if (typeof record[target.field] === "string" && String(record[target.field]).trim()) continue;
      storage.writeJson(filePath, { ...record, [target.field]: "default" });
      migrated += 1;
    }
  }
  return { scanned, migrated };
}
