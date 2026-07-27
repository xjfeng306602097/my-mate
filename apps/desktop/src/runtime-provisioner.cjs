const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

class RuntimeProvisioner {
  constructor(options = {}) {
    this.runtimeRoot = path.resolve(options.runtimeRoot || path.join(__dirname, "..", "..", ".."));
    this.dockerBin = options.dockerBin || process.env.MY_MATE_RUNTIME_DOCKER_BIN || "docker";
    this.execFileImpl = options.execFileImpl || execFileAsync;
    this.images = options.images || [
      {
        id: "runtime-worker",
        reference: process.env.MY_MATE_RUNTIME_WORKER_IMAGE || "my-mate-runtime-worker:0.1.0",
        archive: "runtime-worker-image.tar",
        dockerfile: path.join("services", "runtime-worker", "Dockerfile"),
        buildArgs: ["--build-arg", "MY_MATE_RUNTIME_WORKER_VERSION=0.1.0"],
      },
      {
        id: "artifact-worker",
        reference: process.env.MY_MATE_ARTIFACT_WORKER_IMAGE || "my-mate-artifact-worker:0.1.0",
        archive: "artifact-worker-image.tar",
        dockerfile: path.join("services", "artifact-worker", "Dockerfile"),
        buildArgs: ["--build-arg", "MY_MATE_ARTIFACT_WORKER_VERSION=0.1.0"],
      },
    ];
    this.lastStatus = null;
  }

  async run(args, timeout = 15_000) {
    return await this.execFileImpl(this.dockerBin, args, {
      cwd: this.runtimeRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout,
      windowsHide: true,
    });
  }

  async inspect() {
    const checkedAt = new Date().toISOString();
    try {
      const version = await this.run(["version", "--format", "{{.Server.Version}}"], 8_000);
      const images = [];
      for (const image of this.images) {
        try {
          const inspected = await this.run(["image", "inspect", image.reference, "--format", "{{.Id}}"], 8_000);
          images.push({ id: image.id, reference: image.reference, status: "ready", image_id: inspected.stdout.trim(), recovery: null });
        } catch {
          const archivePath = path.join(this.runtimeRoot, "images", image.archive);
          const dockerfilePath = path.join(this.runtimeRoot, image.dockerfile);
          images.push({
            id: image.id,
            reference: image.reference,
            status: "missing",
            image_id: null,
            recovery: fs.existsSync(archivePath) ? "import" : fs.existsSync(dockerfilePath) ? "build" : "unavailable",
          });
        }
      }
      this.lastStatus = {
        checked_at: checkedAt,
        docker: { status: "ready", version: version.stdout.trim(), error: null },
        images,
      };
    } catch (error) {
      this.lastStatus = {
        checked_at: checkedAt,
        docker: { status: "unavailable", version: null, error: error instanceof Error ? error.message : String(error) },
        images: this.images.map((image) => ({ id: image.id, reference: image.reference, status: "unknown", image_id: null, recovery: null })),
      };
    }
    return this.lastStatus;
  }

  async provision() {
    const initial = await this.inspect();
    if (initial.docker.status !== "ready") return initial;
    for (const current of initial.images.filter((image) => image.status !== "ready")) {
      const image = this.images.find((candidate) => candidate.id === current.id);
      if (!image) continue;
      const archivePath = path.join(this.runtimeRoot, "images", image.archive);
      if (fs.existsSync(archivePath)) {
        await this.run(["load", "--input", archivePath], 20 * 60_000);
        continue;
      }
      const dockerfilePath = path.join(this.runtimeRoot, image.dockerfile);
      if (!fs.existsSync(dockerfilePath)) continue;
      await this.run([
        "build",
        "--file",
        image.dockerfile,
        "--tag",
        image.reference,
        ...image.buildArgs,
        ".",
      ], 20 * 60_000);
    }
    return await this.inspect();
  }
}

module.exports = { RuntimeProvisioner };
