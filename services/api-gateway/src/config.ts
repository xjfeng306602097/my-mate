export type GatewayConfig = {
  port: number;
  controlPlaneBaseUrl: string;
  apiKey: string;
  requestTimeoutMs: number;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

export function readConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: overrides.port ?? Number(process.env.PORT || 4030),
    controlPlaneBaseUrl:
      overrides.controlPlaneBaseUrl ??
      trimTrailingSlash(process.env.MY_MATE_CONTROL_PLANE_BASE_URL || "http://127.0.0.1:4010"),
    apiKey: overrides.apiKey ?? process.env.MY_MATE_API_GATEWAY_API_KEY ?? "",
    requestTimeoutMs:
      overrides.requestTimeoutMs ??
      Number(process.env.MY_MATE_API_GATEWAY_REQUEST_TIMEOUT_MS || 30000),
  };
}
