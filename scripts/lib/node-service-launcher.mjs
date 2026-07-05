import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function prepareLogFiles(logDir, logPrefix) {
  ensureDir(logDir);
  const outPath = path.join(logDir, `${logPrefix}.out.log`);
  const errPath = path.join(logDir, `${logPrefix}.err.log`);
  fs.writeFileSync(outPath, "", "utf-8");
  fs.writeFileSync(errPath, "", "utf-8");
  return { outPath, errPath };
}

function resolveServerPath(workdir, serverPath) {
  return serverPath || path.join(workdir, "dist", "src", "server.js");
}

function parseProcessId(output, name) {
  const pid = Number(output.split(/\r?\n/).at(-1)?.trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Failed to launch ${name}: unexpected Start-Process output "${output}".`);
  }
  return pid;
}

function launchDetachedWindowsNodeProcess({ name, workdir, serverPath, outPath, errPath, env }) {
  const childCommand = [
    '$ErrorActionPreference = "Stop"',
    'Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -Scope Script -ErrorAction SilentlyContinue',
    `Set-Location '${escapePowerShellSingleQuoted(workdir)}'`,
    ...Object.entries(env).map(
      ([key, value]) => `$env:${key}='${escapePowerShellSingleQuoted(value)}'`,
    ),
    `& '${escapePowerShellSingleQuoted(process.execPath)}' '${escapePowerShellSingleQuoted(serverPath)}' ` +
      `1>> '${escapePowerShellSingleQuoted(outPath)}' ` +
      `2>> '${escapePowerShellSingleQuoted(errPath)}'`,
  ].join("\n");
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$process = Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile', '-Command', '${escapePowerShellSingleQuoted(childCommand)}') ` +
      `-WorkingDirectory '${escapePowerShellSingleQuoted(workdir)}' ` +
      "-PassThru",
    "Write-Output $process.Id",
  ].join("\n");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf-8",
    env: {
      ...process.env,
      ...env,
    },
  }).trim();
  return parseProcessId(output, name);
}

export function startPersistentNodeService({
  name,
  workdir,
  logDir,
  logPrefix,
  env,
  serverPath,
}) {
  const resolvedServerPath = resolveServerPath(workdir, serverPath);
  const { outPath, errPath } = prepareLogFiles(logDir, logPrefix);

  if (process.platform === "win32") {
    const pid = launchDetachedWindowsNodeProcess({
      name,
      workdir,
      serverPath: resolvedServerPath,
      outPath,
      errPath,
      env,
    });
    return {
      name,
      pid,
      outPath,
      errPath,
    };
  }

  const outFd = fs.openSync(outPath, "w");
  const errFd = fs.openSync(errPath, "w");
  const child = spawn(process.execPath, [resolvedServerPath], {
    cwd: workdir,
    detached: true,
    env: {
      ...process.env,
      ...env,
    },
    windowsHide: true,
    stdio: ["ignore", outFd, errFd],
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  child.unref();
  return {
    name,
    pid: child.pid,
    outPath,
    errPath,
  };
}

export function startManagedNodeService({
  name,
  workdir,
  logDir,
  logPrefix,
  env,
  serverPath,
}) {
  const resolvedServerPath = resolveServerPath(workdir, serverPath);
  const { outPath, errPath } = prepareLogFiles(logDir, logPrefix);
  const outFd = fs.openSync(outPath, "w");
  const errFd = fs.openSync(errPath, "w");
  const child = spawn(process.execPath, [resolvedServerPath], {
    cwd: workdir,
    env: {
      ...process.env,
      ...env,
    },
    windowsHide: true,
    stdio: ["ignore", outFd, errFd],
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);

  child.on("error", (error) => {
    fs.appendFileSync(
      errPath,
      `[${name}] failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
      "utf-8",
    );
  });

  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      fs.appendFileSync(
        errPath,
        `[${name}] exited early: code=${code} signal=${signal || ""}\n`,
        "utf-8",
      );
    }
  });

  return {
    name,
    pid: child.pid,
    child,
    outPath,
    errPath,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }
      child.kill();
      await sleep(1000);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    },
  };
}
