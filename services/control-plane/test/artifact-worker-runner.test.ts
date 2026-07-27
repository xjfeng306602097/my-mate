import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkArtifactWorkerAvailability, runArtifactWorker } from "../src/artifact-worker-runner.js";

function mountSource(args: string[], target: string): string {
  const mountIndex = args.findIndex(
    (value, index) => value === "--mount" && args[index + 1]?.includes(`target=${target}`),
  );
  const specification = mountIndex >= 0 ? args[mountIndex + 1] : "";
  const source = specification.split(",").find((part) => part.startsWith("source="))?.slice("source=".length);
  if (!source) throw new Error(`Missing ${target} mount.`);
  return source;
}

function writePdfResult(args: string[], outputName: string, digest?: string): Buffer {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n", "ascii");
  const outputRoot = mountSource(args, "/output");
  fs.writeFileSync(path.join(outputRoot, outputName), pdf);
  fs.writeFileSync(path.join(outputRoot, "extracted.txt"), "Verified content.");
  fs.writeFileSync(path.join(outputRoot, "manifest.json"), JSON.stringify({
    ok: true,
    output_file: outputName,
    mime_type: "application/pdf",
    size_bytes: pdf.byteLength,
    sha256: digest || createHash("sha256").update(pdf).digest("hex"),
    preview_file: outputName,
    extracted_text_file: "extracted.txt",
    worker_version: "test",
    validation: { page_count: 1 },
  }));
  return pdf;
}

test("Artifact Worker runner uses an isolated Docker contract and verifies its output", async () => {
  let dockerArgs: string[] = [];
  const result = await runArtifactWorker({
    outputName: "report.pdf",
    content: "# Report\n\nVerified content.",
    title: "Report",
  }, {
    execDocker: async (_executable, args) => {
      dockerArgs = args;
      const inputRoot = mountSource(args, "/input");
      const request = JSON.parse(fs.readFileSync(path.join(inputRoot, "request.json"), "utf8"));
      assert.equal(request.output_name, "report.pdf");
      writePdfResult(args, "report.pdf");
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(result.outputName, "report.pdf");
  assert.equal(result.extractedText, "Verified content.");
  assert.deepEqual(result.validation, { page_count: 1 });
  assert.ok(dockerArgs.includes("none"));
  assert.deepEqual(dockerArgs.slice(0, 4), ["run", "--pull", "never", "--rm"]);
  assert.ok(dockerArgs.includes("--read-only"));
  assert.ok(dockerArgs.includes("--cap-drop"));
  assert.ok(dockerArgs.includes("no-new-privileges"));
});

test("Artifact Worker preflight checks Docker and the pinned local image", async () => {
  const calls: string[][] = [];
  await checkArtifactWorkerAvailability({
    execDocker: async (_executable, args) => {
      calls.push(args);
      return { stdout: "ready", stderr: "" };
    },
  });
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [
    ["version", "--format"],
    ["image", "inspect"],
  ]);
});

test("Artifact Worker preflight reports a missing image without attempting a pull", async () => {
  await assert.rejects(
    () => checkArtifactWorkerAvailability({
      execDocker: async (_executable, args) => {
        if (args[0] === "version") return { stdout: "27.0.0", stderr: "" };
        throw Object.assign(new Error("inspect failed"), {
          stderr: "Error response from daemon: No such image: my-mate-artifact-worker:0.1.0",
        });
      },
    }),
    (error: unknown) => (error as { code?: string }).code === "artifact_worker_image_unavailable",
  );
});

test("Artifact Worker runner rejects a manifest digest mismatch", async () => {
  await assert.rejects(
    () => runArtifactWorker({ outputName: "bad.pdf", content: "content" }, {
      execDocker: async (_executable, args) => {
        writePdfResult(args, "bad.pdf", "0".repeat(64));
        return { stdout: "", stderr: "" };
      },
    }),
    (error: unknown) => (error as { code?: string }).code === "artifact_digest_mismatch",
  );
});
