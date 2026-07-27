import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dockerBin = process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
const image = process.env.MY_MATE_ARTIFACT_WORKER_IMAGE || "my-mate-artifact-worker:0.1.0";
const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-artifact-smoke-input-"));
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-artifact-smoke-output-"));

function runImageTool(entrypoint, args, writable = false) {
  const result = spawnSync(dockerBin, [
    "run", "--pull", "never", "--rm", "--network", "none",
    "--entrypoint", entrypoint,
    "--mount", `type=bind,source=${outputRoot},target=/output${writable ? "" : ",readonly"}`,
    image,
    ...args,
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${entrypoint} validation failed.`);
  }
  return result;
}

try {
  fs.chmodSync(inputRoot, 0o755);
  fs.chmodSync(outputRoot, 0o777);
  fs.writeFileSync(path.join(inputRoot, "request.json"), JSON.stringify({
    schema_version: 1,
    output_name: "twelve-solar-terms.pdf",
    source_file: null,
    content: "# \u5341\u4e8c\u8282\u6c14\n\n1. \u7acb\u6625 - \u6625\u5b63\u5f00\u59cb\n2. \u60ca\u86f0 - \u6625\u96f7\u60ca\u9192\u86f0\u866b\n3. \u6e05\u660e - \u5929\u6c14\u6e05\u6f88\u660e\u6717\n4. \u7acb\u590f - \u590f\u5b63\u5f00\u59cb\n5. \u8292\u79cd - \u8c37\u7269\u64ad\u79cd\u65f6\u8282\n6. \u5c0f\u6691 - \u6691\u70ed\u5f00\u59cb\n7. \u7acb\u79cb - \u79cb\u5b63\u5f00\u59cb\n8. \u767d\u9732 - \u591c\u95f4\u9732\u6c34\u6cdb\u767d\n9. \u5bd2\u9732 - \u6c14\u6e29\u7ee7\u7eed\u4e0b\u964d\n10. \u7acb\u51ac - \u51ac\u5b63\u5f00\u59cb\n11. \u5927\u96ea - \u964d\u96ea\u91cf\u589e\u5927\n12. \u5c0f\u5bd2 - \u5bd2\u51b7\u5f00\u59cb",
    title: "\u5341\u4e8c\u8282\u6c14",
    prefer_source_conversion: false,
  }));
  const result = spawnSync(dockerBin, [
    "run", "--pull", "never", "--rm", "--read-only", "--network", "none",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
    "--mount", `type=bind,source=${inputRoot},target=/input,readonly`,
    "--mount", `type=bind,source=${outputRoot},target=/output`,
    image,
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Artifact Worker smoke failed.");

  const manifest = JSON.parse(fs.readFileSync(path.join(outputRoot, "manifest.json"), "utf8"));
  const pdf = fs.readFileSync(path.join(outputRoot, manifest.output_file));
  const extractedText = fs.readFileSync(path.join(outputRoot, manifest.extracted_text_file), "utf8");
  const digest = createHash("sha256").update(pdf).digest("hex");
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Smoke output is not a PDF.");
  if (manifest.sha256 !== digest) throw new Error("Smoke output digest does not match its manifest.");
  if (!extractedText.includes("\u5341\u4e8c\u8282\u6c14") || !extractedText.includes("\u7acb\u6625") || extractedText.includes("\0")) {
    throw new Error("Smoke output does not contain extractable Chinese text.");
  }
  if (Number(manifest.validation?.embedded_font_count || 0) < 1) {
    throw new Error("Smoke output does not report an embedded font.");
  }
  if (Number(manifest.validation?.render_ink_pixels || 0) < 128) {
    throw new Error("Smoke output rendered as a blank or nearly blank page.");
  }

  const fontReport = runImageTool("pdffonts", [`/output/${manifest.output_file}`]);
  const embeddedFont = fontReport.stdout
    .split(/\r?\n/u)
    .slice(2)
    .some((line) => line.trim().split(/\s+/u)[3] === "yes");
  if (!embeddedFont) throw new Error("Poppler did not find an embedded PDF font.");
  if (fontReport.stderr.trim()) throw new Error(`Poppler font validation reported: ${fontReport.stderr.trim()}`);

  const render = runImageTool("pdftoppm", [
    "-f", "1", "-singlefile", "-png", `/output/${manifest.output_file}`, "/output/rendered-page-1",
  ], true);
  if (render.stderr.trim()) throw new Error(`Poppler rendering reported: ${render.stderr.trim()}`);
  const renderedPath = path.join(outputRoot, "rendered-page-1.png");
  if (!fs.existsSync(renderedPath) || fs.statSync(renderedPath).size < 1_000) {
    throw new Error("Poppler did not produce a usable rendered page.");
  }

  const pixelProbe = runImageTool("python", [
    "-c",
    [
      "import fitz, json",
      "p=fitz.Pixmap('/output/rendered-page-1.png')",
      "channels=p.n-(1 if p.alpha else 0)",
      "samples=p.samples",
      "ink=sum(1 for i in range(0,len(samples),p.n) if min(samples[i:i+channels]) < 245)",
      "print(json.dumps({'width':p.width,'height':p.height,'ink_pixels':ink,'total_pixels':p.width*p.height}))",
    ].join(";"),
  ]);
  const pixels = JSON.parse(pixelProbe.stdout.trim());
  if (pixels.ink_pixels < Math.max(128, Math.floor(pixels.total_pixels * 0.0002))) {
    throw new Error("Rendered PNG is blank or nearly blank.");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    image,
    worker_version: manifest.worker_version,
    size_bytes: pdf.byteLength,
    sha256: digest,
    validation: manifest.validation,
    poppler_render: pixels,
  })}\n`);
} finally {
  fs.rmSync(inputRoot, { recursive: true, force: true });
  fs.rmSync(outputRoot, { recursive: true, force: true });
}
