export interface RuntimeWorkerBuildInfo {
  version: string;
  image_reference: string | null;
  revision: string | null;
  built_at: string | null;
  source: string | null;
}

function optional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getRuntimeWorkerBuildInfo(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeWorkerBuildInfo {
  return {
    version: env.MY_MATE_RUNTIME_WORKER_VERSION?.trim() || "0.1.0",
    image_reference: optional(env.MY_MATE_RUNTIME_WORKER_IMAGE),
    revision: optional(env.MY_MATE_BUILD_REVISION),
    built_at: optional(env.MY_MATE_BUILD_DATE),
    source: optional(env.MY_MATE_BUILD_SOURCE),
  };
}
