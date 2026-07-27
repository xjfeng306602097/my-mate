import fs from "node:fs";
import path from "node:path";

const input = JSON.parse(fs.readFileSync("/input.json", "utf-8"));
const relative = String(input.path || "").replaceAll("\\", "/");
if (!relative || path.posix.isAbsolute(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) {
  throw new Error("A safe relative output path is required.");
}
if (relative.split("/").some((part) => [".git", ".ssh", ".env", "credentials", "secrets"].includes(part.toLowerCase()))) {
  throw new Error("Sensitive output paths are not allowed.");
}
const content = String(input.content || "");
if (!content || Buffer.byteLength(content) > 1024 * 1024) throw new Error("Text output must be between 1 byte and 1 MiB.");
const target = path.resolve("/workspace", relative);
if (!target.startsWith("/workspace/")) throw new Error("Output escapes the Workspace.");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, content, "utf-8");
process.stdout.write(JSON.stringify({ path: relative, bytes: Buffer.byteLength(content), created: true }));
