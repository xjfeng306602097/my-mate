import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(repoRoot, "apps", "desktop", "release");
if (!fs.existsSync(releaseRoot)) throw new Error("Desktop release directory does not exist.");
const files = fs.readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS.txt")
  .map((entry) => entry.name)
  .sort();
if (!files.length) throw new Error("Desktop release directory contains no distributable files.");
const lines = files.map((fileName) => {
  const digest = createHash("sha256").update(fs.readFileSync(path.join(releaseRoot, fileName))).digest("hex");
  return `${digest}  ${fileName}`;
});
fs.writeFileSync(path.join(releaseRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
console.log(`Hashed ${files.length} Desktop release artifact(s).`);

