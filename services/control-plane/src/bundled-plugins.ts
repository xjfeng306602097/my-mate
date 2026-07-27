import type { CapabilityPluginModule } from "./plugin-host.js";
import { fetchWeb, searchWeb } from "./web-capabilities.js";
import { memoryCorePlugin } from "./memory-capabilities.js";
import { skillsCorePlugin } from "./skill-capabilities.js";

const webCorePlugin: CapabilityPluginModule = {
  register(context) {
    context.registerTool("web_search", async ({ arguments: args }) => {
      return await searchWeb(String(args.query || "").trim(), Number(args.limit || 5));
    });
    context.registerTool("web_fetch", async ({ arguments: args }) => {
      return await fetchWeb({
        url: String(args.url || "").trim(),
        max_chars: Number(args.max_chars || 30_000),
        format: args.format === "html" ? "html" : "text",
      });
    });
  },
};

const bundledPlugins = new Map<string, CapabilityPluginModule>([
  ["web.core", webCorePlugin],
  ["memory.core", memoryCorePlugin],
  ["skills.core", skillsCorePlugin],
]);

export function getBundledPluginModule(pluginId: string): CapabilityPluginModule | null {
  return bundledPlugins.get(pluginId) || null;
}
