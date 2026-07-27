import fs from "node:fs";
import path from "node:path";

const TOOL_MAP: Record<string, string> = {
  web_extract: "web_fetch",
  web_search: "web_search",
  read_file: "workspace_read_text",
  search_files: "workspace_list",
  browser_navigate: "browser_navigate",
  memory: "memory_search",
  skill_view: "skill_resource_read",
};

function frontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const result: Record<string, unknown> = {};
  for (const line of text.slice(3, end).split(/\r?\n/u)) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/u.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/gu, "");
    result[match[1]] = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1).split(",").map((item) => item.trim()) : value;
  }
  return result;
}

export function inspectHermesSkill(sourcePath: string) {
  const root = fs.realpathSync(path.resolve(sourcePath));
  const skillPath = path.join(root, "SKILL.md");
  if (!fs.existsSync(skillPath)) throw new Error("HERMES_SKILL_MD_NOT_FOUND");
  const content = fs.readFileSync(skillPath, "utf-8");
  const metadata = frontmatter(content);
  const toolReferences = [...content.matchAll(/`([a-z][a-z0-9_-]+)`/giu)].map((match) => match[1]);
  const nativeTools = [...new Set(toolReferences.filter((tool) => tool in TOOL_MAP))];
  const unsupportedTools = [...new Set(toolReferences.filter((tool) => ["terminal", "write_file", "patch", "execute_code", "delegate_task", "vision_analyze", "image_generate", "text_to_speech", "cronjob"].includes(tool)))];
  const scriptsRoot = path.join(root, "scripts");
  const scripts = fs.existsSync(scriptsRoot)
    ? fs.readdirSync(scriptsRoot, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
    : [];
  return {
    source_path: root,
    name: String(metadata.name || path.basename(root)),
    description: String(metadata.description || "Imported Hermes Skill."),
    platforms: Array.isArray(metadata.platforms) ? metadata.platforms : [],
    mapped_tools: nativeTools.map((tool) => ({ hermes: tool, my_mate: TOOL_MAP[tool] })),
    unsupported_tools: unsupportedTools,
    scripts,
    compatibility: unsupportedTools.length || scripts.length ? "requires_review" : "content_only_ready",
    importable: true,
  };
}
