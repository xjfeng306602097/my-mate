import type { UsageSummary } from "@my-mate/shared-types/runtime-protocol";
import type { EstimatedMoneyAmount } from "@my-mate/shared-types/runtime-protocol";
import { loadPricingCatalog, type PricingCatalog, type PricingCatalogEntry } from "./catalog.js";
import { sumTokenRates } from "./decimal.js";

function findExactEntry(
  catalog: PricingCatalog,
  provider: string | null | undefined,
  model: string | null | undefined,
): PricingCatalogEntry | null {
  if (!provider || !model) return null;
  return catalog.entries.find((entry) => entry.provider === provider && entry.model === model) || null;
}

export function estimateUsageCost(
  usage: UsageSummary,
  provider: string | null | undefined,
  model: string | null | undefined,
  catalog: PricingCatalog = loadPricingCatalog(),
): EstimatedMoneyAmount | null {
  const entry = findExactEntry(catalog, provider, model);
  if (!entry || usage.input_tokens === null || usage.output_tokens === null) return null;
  const cacheReadRate = entry.cache_read_per_million_tokens;
  const cacheWriteRate = entry.cache_write_per_million_tokens;
  if (cacheReadRate && usage.cache_read_tokens === null) return null;
  if (cacheWriteRate && usage.cache_write_tokens === null) return null;
  const cacheRead = cacheReadRate ? usage.cache_read_tokens || 0 : 0;
  const cacheWrite = cacheWriteRate ? usage.cache_write_tokens || 0 : 0;
  const uncachedInput = usage.input_tokens - cacheRead - cacheWrite;
  if (uncachedInput < 0) return null;
  const rates = [
    { tokens: uncachedInput, ratePerMillion: entry.input_per_million_tokens },
    { tokens: usage.output_tokens, ratePerMillion: entry.output_per_million_tokens },
  ];
  if (cacheReadRate) rates.push({ tokens: cacheRead, ratePerMillion: cacheReadRate });
  if (cacheWriteRate) rates.push({ tokens: cacheWrite, ratePerMillion: cacheWriteRate });
  return {
    currency: entry.currency,
    amount_decimal: sumTokenRates(rates),
    catalog_id: catalog.catalog_id,
    catalog_version: catalog.catalog_version,
  };
}

export function enrichUsageWithEstimatedCost(
  usage: UsageSummary | null | undefined,
  provider: string | null | undefined,
  model: string | null | undefined,
  catalog?: PricingCatalog,
): UsageSummary | null {
  if (!usage) return null;
  if (usage.estimated_cost) return usage;
  return {
    ...usage,
    provider_reported_cost: usage.provider_reported_cost,
    estimated_cost: estimateUsageCost(usage, provider, model, catalog),
  };
}
