import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_DIRECTORY_NAME = ".control-plane.lock";
const OWNER_FILE_NAME = "owner.json";

interface LeaseOwner {
  owner_id: string;
  pid: number;
  port: number;
  started_at: string;
  data_dir: string;
}

export interface DataDirectoryLease {
  owner: LeaseOwner;
  release(): void;
}

function readOwner(ownerPath: string): LeaseOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(ownerPath, "utf-8")) as Partial<LeaseOwner>;
    if (
      typeof value.owner_id !== "string" ||
      !Number.isInteger(value.pid) ||
      !Number.isInteger(value.port) ||
      typeof value.started_at !== "string" ||
      typeof value.data_dir !== "string"
    ) {
      return null;
    }
    return value as LeaseOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}

export function acquireDataDirectoryLease(dataDir: string, port: number): DataDirectoryLease {
  const resolvedDataDir = path.resolve(dataDir);
  const lockDir = path.join(resolvedDataDir, LOCK_DIRECTORY_NAME);
  const ownerPath = path.join(lockDir, OWNER_FILE_NAME);
  const owner: LeaseOwner = {
    owner_id: randomUUID(),
    pid: process.pid,
    port,
    started_at: new Date().toISOString(),
    data_dir: resolvedDataDir,
  };

  fs.mkdirSync(resolvedDataDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf-8");
      let released = false;
      return {
        owner,
        release() {
          if (released) return;
          released = true;
          const currentOwner = readOwner(ownerPath);
          if (currentOwner?.owner_id === owner.owner_id) {
            fs.rmSync(lockDir, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      const code = error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : null;
      if (code !== "EEXIST") throw error;

      const existingOwner = readOwner(ownerPath);
      if (!existingOwner || isProcessAlive(existingOwner.pid)) {
        const detail = existingOwner
          ? `pid=${existingOwner.pid}, port=${existingOwner.port}, started_at=${existingOwner.started_at}`
          : "owner metadata is not yet available";
        throw new Error(
          `MY_MATE_DATA_DIR_IN_USE: ${resolvedDataDir} is already owned by another Control Plane (${detail}). ` +
          "Stop the existing stack or configure a different MY_MATE_DATA_DIR.",
        );
      }

      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }

  throw new Error(`MY_MATE_DATA_DIR_LEASE_FAILED: unable to lock ${resolvedDataDir}.`);
}
