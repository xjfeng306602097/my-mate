import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactOutputDirectory,
  collectArtifactOutputs,
  prepareArtifactOutputDirectory,
} from "../src/artifact-collector.js";
import { buildJob } from "./worker-runtime.test.js";

test("artifact collector publishes nested text, code, and binary outputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-artifacts-"));
  try {
    const job = buildJob();
    job.provision.env.MY_MATE_WORKSPACE = root;
    const outputDir = prepareArtifactOutputDirectory(job);
    fs.mkdirSync(path.join(outputDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "src", "Main.java"), "public class Main {}\n", "utf8");
    fs.writeFileSync(path.join(outputDir, "report.pdf"), Buffer.from("%PDF-1.4\nfixture\n"));

    const artifacts = collectArtifactOutputs(job);
    assert.equal(artifacts.length, 2);
    assert.deepEqual(artifacts.map((artifact) => artifact.name), ["report.pdf", "Main.java"]);
    assert.equal(artifacts.find((artifact) => artifact.name === "Main.java")?.mime_type, "text/x-java-source; charset=utf-8");
    assert.equal(artifacts.find((artifact) => artifact.name === "report.pdf")?.mime_type, "application/pdf");
    assert.ok(artifacts.every((artifact) => artifact.type === "deliverable"));
    assert.ok(artifacts.every((artifact) => artifact.storage_uri.startsWith("workspace://.my-mate/outputs/")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact collector rejects empty and sensitive outputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-artifact-security-"));
  try {
    const job = buildJob();
    job.provision.env.MY_MATE_WORKSPACE = root;
    prepareArtifactOutputDirectory(job);
    fs.writeFileSync(path.join(artifactOutputDirectory(job), ".env"), "API_KEY=secret\n", "utf8");
    assert.throws(() => collectArtifactOutputs(job), /sensitive file name/);

    prepareArtifactOutputDirectory(job);
    fs.writeFileSync(path.join(artifactOutputDirectory(job), "empty.xml"), "");
    assert.throws(() => collectArtifactOutputs(job), /is empty/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
