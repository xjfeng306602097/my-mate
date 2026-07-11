import { ApiError } from "./client.js";

export interface CommandIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export const processIo: CommandIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

export function writeJson(io: CommandIo, value: unknown): void {
  io.stdout(JSON.stringify(value, null, 2));
}

export function reportCommandError(io: CommandIo, error: unknown): number {
  if (error instanceof ApiError) {
    io.stderr(`${error.code ? `${error.code}: ` : ""}${error.message}`);
    return error.code === "request_timeout" ? 4 : 3;
  }
  io.stderr(error instanceof Error ? error.message : "Command failed.");
  return 2;
}
