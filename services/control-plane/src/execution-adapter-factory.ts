import { EXECUTION_ADAPTER_KIND } from "./config.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import { LocalExecutionAdapter } from "./local-execution-engine.js";
import { OpenClawExecutionAdapter } from "./openclaw-execution-adapter.js";

let adapterInstance: ExecutionAdapter | null = null;

export function getExecutionAdapter(): ExecutionAdapter {
  if (adapterInstance) {
    return adapterInstance;
  }

  if (EXECUTION_ADAPTER_KIND === "openclaw") {
    adapterInstance = new OpenClawExecutionAdapter();
    return adapterInstance;
  }

  adapterInstance = new LocalExecutionAdapter();
  return adapterInstance;
}
