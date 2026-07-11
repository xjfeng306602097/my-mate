import { createRuntimeWorkerServer } from "./server.js";
import { RuntimeWorkerManagerClient } from "./manager-client.js";

const port = Number(process.env.PORT || 4040);
const managerUrl = process.env.MY_MATE_MANAGER_WS_URL || "";
const workerId = process.env.MY_MATE_WORKER_ID || `runtime-worker-${process.pid}`;
const token = process.env.MY_MATE_WORKER_TOKEN || "";

const server = createRuntimeWorkerServer();
const managerClient =
  managerUrl && token
    ? new RuntimeWorkerManagerClient({
        managerUrl,
        workerId,
        token,
        exitOnRelease: true,
      })
    : null;

server.listen(port, "0.0.0.0", () => {
  console.log(`My Mate runtime-worker listening on http://0.0.0.0:${port}`);
  if (managerClient) {
    console.log(`Connecting runtime worker ${workerId} to ${managerUrl}`);
    managerClient.start();
  } else {
    console.log("Runtime worker manager connection is disabled; HTTP mode only.");
  }
});

function shutdown(): void {
  managerClient?.stop();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
