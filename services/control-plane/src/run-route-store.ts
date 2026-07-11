import path from "node:path";
import { RUN_ROUTES_DIR } from "./config.js";
import { getJsonStorageBackend } from "./storage-backend.js";
import type { RunRouteSnapshot } from "./types.js";
import { ensureDir, writeJsonAtomic } from "./utils.js";
import { validateRunRoute } from "./validators.js";
import { getRun } from "./run-store.js";
import { getRunPlan } from "./run-plan-store.js";
import { getTemplate } from "./template-store.js";
import { buildLegacyRunRouteSnapshot } from "./run-route.js";

function routePath(runId: string): string {
  return path.join(RUN_ROUTES_DIR, `${encodeURIComponent(runId)}.json`);
}

export function saveRunRoute(route: RunRouteSnapshot): RunRouteSnapshot {
  if (!validateRunRoute(route)) {
    const detail = validateRunRoute.errors
      ?.map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`RunRoute validation failed: ${detail || "unknown schema error"}`);
  }
  ensureDir(RUN_ROUTES_DIR);
  writeJsonAtomic(routePath(route.run_id), route);
  return route;
}

export function getRunRoute(runId: string): RunRouteSnapshot | null {
  const storage = getJsonStorageBackend();
  const filePath = routePath(runId);
  return storage.exists(filePath)
    ? storage.readJson<RunRouteSnapshot>(filePath)
    : null;
}

export function getRunRouteOrLegacy(runId: string): RunRouteSnapshot | null {
  const persisted = getRunRoute(runId);
  if (persisted) {
    return persisted;
  }
  const run = getRun(runId);
  const plan = getRunPlan(runId);
  if (!run || !plan) {
    return null;
  }
  return buildLegacyRunRouteSnapshot({
    run,
    plan,
    templateName: getTemplate(run.template_id)?.name || null,
  });
}
