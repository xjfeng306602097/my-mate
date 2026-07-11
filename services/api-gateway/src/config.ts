import type {
  AuthenticatedPrincipal,
  WorkspaceMembership,
} from "@my-mate/shared-types/identity";

export interface GatewayIdentity {
  token: string;
  principal: AuthenticatedPrincipal;
  memberships: WorkspaceMembership[];
}

export type GatewayConfig = {
  port: number;
  controlPlaneBaseUrl: string;
  apiKey: string;
  identities: GatewayIdentity[];
  internalAuthSecret: string;
  requestTimeoutMs: number;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function parseIdentities(value: string | undefined): GatewayIdentity[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("MY_MATE_API_GATEWAY_IDENTITIES_JSON must be a JSON array.");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Gateway identity at index ${index} must be an object.`);
    }
    const value = item as Partial<GatewayIdentity>;
    if (
      typeof value.token !== "string" ||
      !value.token ||
      !value.principal ||
      typeof value.principal.principal_id !== "string" ||
      !Array.isArray(value.memberships) ||
      value.memberships.length === 0
    ) {
      throw new Error(`Gateway identity at index ${index} is incomplete.`);
    }
    return value as GatewayIdentity;
  });
}

export function readConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const identities =
    overrides.identities ?? parseIdentities(process.env.MY_MATE_API_GATEWAY_IDENTITIES_JSON);
  const internalAuthSecret =
    overrides.internalAuthSecret ?? process.env.MY_MATE_INTERNAL_AUTH_SECRET ?? "";
  if (identities.length > 0 && !internalAuthSecret) {
    throw new Error("MY_MATE_INTERNAL_AUTH_SECRET is required when configured identities are enabled.");
  }
  return {
    port: overrides.port ?? Number(process.env.PORT || 4030),
    controlPlaneBaseUrl:
      overrides.controlPlaneBaseUrl ??
      trimTrailingSlash(process.env.MY_MATE_CONTROL_PLANE_BASE_URL || "http://127.0.0.1:4010"),
    apiKey: overrides.apiKey ?? process.env.MY_MATE_API_GATEWAY_API_KEY ?? "",
    identities,
    internalAuthSecret,
    requestTimeoutMs:
      overrides.requestTimeoutMs ??
      Number(process.env.MY_MATE_API_GATEWAY_REQUEST_TIMEOUT_MS || 30000),
  };
}
