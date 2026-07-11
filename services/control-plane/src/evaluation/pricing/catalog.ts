import fs from "node:fs";
import path from "node:path";

export interface PricingCatalogEntry {
  provider: string;
  model: string;
  currency: string;
  input_per_million_tokens: string;
  output_per_million_tokens: string;
  cache_read_per_million_tokens?: string | null;
  cache_write_per_million_tokens?: string | null;
}

export interface PricingCatalog {
  catalog_id: string;
  catalog_version: string;
  entries: PricingCatalogEntry[];
}

export const DEFAULT_PRICING_CATALOG: PricingCatalog = {
  catalog_id: "my-mate-provider-pricing",
  catalog_version: "2026-07-10-empty",
  entries: [],
};

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value);
}

export function validatePricingCatalog(value: unknown): PricingCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pricing catalog must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.catalog_id !== "string" || !record.catalog_id) {
    throw new Error("Pricing catalog requires catalog_id.");
  }
  if (typeof record.catalog_version !== "string" || !record.catalog_version) {
    throw new Error("Pricing catalog requires catalog_version.");
  }
  if (!Array.isArray(record.entries)) {
    throw new Error("Pricing catalog requires an entries array.");
  }
  const entries = record.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Pricing catalog entry ${index} must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    for (const key of ["provider", "model", "currency"] as const) {
      if (typeof item[key] !== "string" || !item[key]) {
        throw new Error(`Pricing catalog entry ${index} requires ${key}.`);
      }
    }
    for (const key of ["input_per_million_tokens", "output_per_million_tokens"] as const) {
      if (!isDecimal(item[key])) {
        throw new Error(`Pricing catalog entry ${index} has invalid ${key}.`);
      }
    }
    for (const key of ["cache_read_per_million_tokens", "cache_write_per_million_tokens"] as const) {
      if (item[key] !== undefined && item[key] !== null && !isDecimal(item[key])) {
        throw new Error(`Pricing catalog entry ${index} has invalid ${key}.`);
      }
    }
    return item as unknown as PricingCatalogEntry;
  });
  return {
    catalog_id: record.catalog_id,
    catalog_version: record.catalog_version,
    entries,
  };
}

export function loadPricingCatalog(): PricingCatalog {
  const configuredPath = process.env.MY_MATE_PRICING_CATALOG_PATH;
  if (!configuredPath) return DEFAULT_PRICING_CATALOG;
  const absolutePath = path.resolve(configuredPath);
  return validatePricingCatalog(JSON.parse(fs.readFileSync(absolutePath, "utf-8")));
}
