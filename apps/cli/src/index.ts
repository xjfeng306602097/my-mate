#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { ApiClient } from "./client.js";
import { CliConfigError, resolveCliConfig, type CliGlobalOptions } from "./config.js";
import { executeDoctor } from "./commands/doctor.js";
import { executeEvaluation } from "./commands/evaluation.js";
import { executeRun } from "./commands/run.js";
import { executeScorecard } from "./commands/scorecard.js";
import { executeSupervise } from "./commands/supervise.js";
import { executeTrace } from "./commands/trace.js";
import { executeReplay } from "./commands/replay.js";
import { executeReplayPlan } from "./commands/replay-plan.js";
import { executeRerun } from "./commands/rerun.js";
import { executeAudit, executeWhoAmI, executeWorkspaces } from "./commands/identity.js";
import { processIo } from "./output.js";

function clientFor(command: Command): ApiClient {
  const globals = command.optsWithGlobals() as CliGlobalOptions;
  return new ApiClient(resolveCliConfig({ options: globals }));
}

export function buildProgram(): Command {
  const program = new Command()
    .name("my-mate")
    .description("Operate and verify My Mate runs through API Gateway")
    .version("0.1.0")
    .option("--base-url <url>", "API Gateway base URL")
    .option("--api-key <key>", "API Gateway Bearer token")
    .option("--workspace <id>", "Workspace ID")
    .option("--config <path>", "CLI config file path")
    .showHelpAfterError();

  program
    .command("whoami")
    .option("--json", "Print the identity response as JSON")
    .action(async (options, command) => {
      process.exitCode = await executeWhoAmI(clientFor(command), options, processIo);
    });

  program
    .command("workspaces")
    .option("--json", "Print the workspace list as JSON")
    .action(async (options, command) => {
      process.exitCode = await executeWorkspaces(clientFor(command), options, processIo);
    });

  program
    .command("audit")
    .option("--limit <count>", "Maximum events", (value) => Number(value), 50)
    .addOption(new Option("--outcome <outcome>").choices(["allowed", "denied", "error"]))
    .option("--actor <principal_id>", "Filter by principal")
    .option("--json", "Print the audit response as JSON")
    .action(async (options, command) => {
      process.exitCode = await executeAudit(clientFor(command), options, processIo);
    });

  program
    .command("doctor")
    .addOption(new Option("--mode <mode>").choices(["quick", "docker", "model"]).default("quick"))
    .addOption(new Option("--runtime <runtime>").choices(["local", "docker-worker", "openclaw", "codex", "claude-sdk", "kimi"]))
    .option("--model-probe", "Perform an opt-in live provider request")
    .option("--json", "Print the API response as JSON")
    .action(async (options, command) => {
      process.exitCode = await executeDoctor(clientFor(command), options, processIo);
    });

  program
    .command("supervise")
    .argument("<run_id>")
    .option("--follow", "Poll until the run is terminal and settled")
    .option("--cursor <cursor>", "Resume from an opaque supervision cursor")
    .option("--interval <ms>", "Override poll interval", (value) => Number(value))
    .option("--timeout <sec>", "Stop following after this duration", (value) => Number(value))
    .option("--json", "Print one JSON response")
    .option("--json-lines", "Print one compact JSON object per poll")
    .action(async (runId, options, command) => {
      const outcome = await executeSupervise(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("scorecard")
    .argument("<run_id>")
    .option("--profile <profile>", "Scorecard profile", "pipeline-v1")
    .option("--allow-incomplete", "Create a diagnostic scorecard before terminal settling")
    .option("--json", "Print the API response as JSON")
    .action(async (runId, options, command) => {
      const outcome = await executeScorecard(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("eval")
    .argument("<run_id>")
    .option("--evaluator <id>", "Evaluator id: none, deterministic-v1, or model-v1", "none")
    .option("--allow-incomplete", "Create a diagnostic evaluation before terminal settling")
    .option("--require-quality", "Fail when semantic quality was not evaluated")
    .option("--interval <ms>", "Model evaluation polling interval", (value) => Number(value))
    .option("--timeout <sec>", "Model evaluation timeout", (value) => Number(value), 120)
    .option("--json", "Print the terminal evaluation as JSON")
    .action(async (runId, options, command) => {
      const outcome = await executeEvaluation(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("trace")
    .argument("<run_id>")
    .option("--node <node_run_id>", "Scope trace to one node")
    .addOption(new Option("--kind <kind>").choices(["run", "node", "job", "model", "tool", "handoff", "artifact", "control"]))
    .option("--json", "Print the trace projection as JSON")
    .action(async (runId, options, command) => {
      const outcome = await executeTrace(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("replay")
    .argument("<run_id>")
    .option("--json", "Print the replay result as JSON")
    .action(async (runId, options, command) => {
      const outcome = await executeReplay(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("replay-plan")
    .argument("<run_id>")
    .option("--scorecard <id>", "Use a specific scorecard")
    .option("--evaluation <id>", "Use a specific evaluation")
    .option("--json", "Print the replay plan as JSON")
    .action(async (runId, options, command) => {
      const outcome = await executeReplayPlan(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("rerun")
    .argument("<run_id>")
    .requiredOption("--reason <text>", "Audit reason for the rerun")
    .option("--input <key=value...>", "Override an original input; repeat for multiple values", (value, values: string[]) => [...values, value], [])
    .option("--idempotency-key <key>", "Stable key for safe command retries")
    .option("--json", "Print the linked rerun as JSON")
    .action(async (runId, options, command) => {
      const outcome = await executeRerun(clientFor(command), runId, options, processIo);
      process.exitCode = outcome.exitCode;
    });

  program
    .command("run")
    .requiredOption("--template-id <id>", "Published workflow template ID")
    .requiredOption("--intent <text>", "Run intent")
    .option("--input <key=value...>", "Run input; repeat for multiple values", (value, values: string[]) => [...values, value], [])
    .addOption(new Option("--validation-mode <mode>").choices(["warn", "strict", "bypass"]).default("warn"))
    .option("--follow", "Follow the run until terminal and settled")
    .option("--scorecard", "Create pipeline-v1 scorecard after following")
    .option("--timeout <sec>", "Follow timeout", (value) => Number(value))
    .option("--json", "Print JSON output")
    .action(async (options, command) => {
      process.exitCode = await executeRun(clientFor(command), options, processIo);
    });

  return program;
}

export async function main(argv = process.argv): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return Number(process.exitCode || 0);
  } catch (error) {
    if (error instanceof CommanderError) return error.code === "commander.helpDisplayed" ? 0 : 2;
    if (error instanceof CliConfigError) {
      processIo.stderr(error.message);
      return 2;
    }
    processIo.stderr(error instanceof Error ? error.message : "CLI failed.");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
