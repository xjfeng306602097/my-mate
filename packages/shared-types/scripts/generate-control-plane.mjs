import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(packageRoot, "..", "..", "openapi", "control-plane.openapi.yaml");
const outputPath = path.join(packageRoot, "src", "generated", "control-plane.ts");
const checkOnly = process.argv.includes("--check");
const header = [
  "// This file is generated from openapi/control-plane.openapi.yaml.",
  "// Run `npm --prefix packages/shared-types run generate:control-plane` to update it.",
  "",
].join("\n");

const ast = await openapiTS(pathToFileURL(sourcePath), {
  alphabetize: true,
  defaultNonNullable: false,
  exportType: true,
  immutable: true,
  rootTypes: true,
});
const generated = `${header}${astToString(ast).replace(/\r\n/g, "\n")}`;

if (checkOnly) {
  const current = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf-8").replace(/\r\n/g, "\n")
    : "";
  if (current !== generated) {
    console.error(
      "Generated Control Plane types are stale. Run `npm --prefix packages/shared-types run generate:control-plane`.",
    );
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated, "utf-8");
  console.log(path.relative(packageRoot, outputPath));
}
