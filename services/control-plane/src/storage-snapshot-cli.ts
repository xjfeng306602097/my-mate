import fs from "node:fs";
import path from "node:path";
import {
  exportJsonStorageSnapshot,
  importJsonStorageSnapshot,
  type JsonStorageSnapshot,
} from "./storage-snapshot.js";

function printUsage(): never {
  throw new Error(
    [
      "Usage:",
      "  tsx src/storage-snapshot-cli.ts export <snapshot.json>",
      "  tsx src/storage-snapshot-cli.ts import <snapshot.json>",
    ].join("\n"),
  );
}

const [command, snapshotPath] = process.argv.slice(2);
if (!command || !snapshotPath || !["export", "import"].includes(command)) {
  printUsage();
}

if (command === "export") {
  const snapshot = exportJsonStorageSnapshot();
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  console.log(
    `Exported ${snapshot.entries.length} storage record(s) from ${snapshot.source_backend_kind} to ${snapshotPath}`,
  );
} else {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as JsonStorageSnapshot;
  const result = importJsonStorageSnapshot(snapshot);
  console.log(`Imported ${result.written_entries} storage record(s) from ${snapshotPath}`);
}
