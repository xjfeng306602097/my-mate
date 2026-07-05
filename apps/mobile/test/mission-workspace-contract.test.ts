import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taskThreadSource = readFileSync("app/tasks/[sessionId].tsx", "utf8");

test("task screen keeps versioned mission workspace contract as primary source", () => {
  const requiredMarkers = [
    "const hasVersionedWorkspaceContract",
    "missionSnapshot?.workspace_contract_version",
    "return missionSnapshot?.pipelines || []",
    "return missionSnapshot?.artifactSurfaces || []",
    "const useContractWorkspaceSections",
    "hasVersionedWorkspaceContract && missionWorkspaceSections.length > 0",
    "contractSection?.label || section.eyebrow",
    "contractSection?.title || section.title",
    "contractSection?.summary || section.detail",
    "missionSnapshot?.stages?.length",
    '!hasVersionedWorkspaceContract && stage.key === "execution"',
  ];

  for (const marker of requiredMarkers) {
    assert.ok(taskThreadSource.includes(marker), `Missing task screen contract marker: ${marker}`);
  }
});
