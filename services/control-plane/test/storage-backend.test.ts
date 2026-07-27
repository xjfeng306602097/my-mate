import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { appendRunEvent, listRunEvents } from "../src/event-store.js";
import {
  NODE_RUNS_DIR,
  TEMPLATES_DIR,
  AGENT_PROFILES_DIR,
  SKILLS_DIR,
  DATA_DIR,
  EVALUATION_SNAPSHOTS_DIR,
  RUN_PLAN_INITIAL_DIR,
  RUN_ROUTES_DIR,
  SCORECARDS_DIR,
  MEMORIES_DIR,
  MEMORY_CANDIDATES_DIR,
  overrideDataDir,
} from "../src/config.js";
import {
  approveMemoryCandidate,
  createMemory,
  createMemoryCandidate,
  listMemories,
} from "../src/memory-store.js";
import { getNodeRun, listNodeRuns, saveNodeRuns } from "../src/node-run-store.js";
import { upsertSkill, listSkills } from "../src/registry-store.js";
import { listLegacyAgentProfiles } from "../src/legacy-agent-profile-store.js";
import {
  createJsonStorageBackend,
  getJsonStorageBackend,
  getJsonStorageBackendKind,
  migratePhysicalFileJsonToSqlite,
  setJsonStorageBackend,
  type JsonStorageBackend,
} from "../src/storage-backend.js";
import {
  exportJsonStorageSnapshot,
  importJsonStorageSnapshot,
} from "../src/storage-snapshot.js";
import { createTemplate, getTemplate, listTemplates } from "../src/template-store.js";
import type { NodeRunRecord } from "../src/types.js";
import { resetTestRoot } from "./helpers.js";

class MemoryJsonStorageBackend implements JsonStorageBackend {
  readonly kind = "memory-test";

  private readonly dirs = new Set<string>();
  private readonly files = new Map<string, unknown>();

  ensureDir(dirPath: string): void {
    let current = path.resolve(dirPath);
    while (!this.dirs.has(current)) {
      this.dirs.add(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  exists(filePath: string): boolean {
    return this.files.has(path.resolve(filePath));
  }

  listDirs(dirPath: string): string[] {
    const resolvedDir = path.resolve(dirPath);
    this.ensureDir(resolvedDir);
    return [...this.dirs]
      .filter((candidate) => path.dirname(candidate) === resolvedDir && candidate !== resolvedDir)
      .sort((a, b) => a.localeCompare(b));
  }

  listJsonFiles(dirPath: string): string[] {
    const resolvedDir = path.resolve(dirPath);
    this.ensureDir(resolvedDir);
    const prefix = `${resolvedDir}${path.sep}`;
    return [...this.files.keys()]
      .filter((filePath) => path.dirname(filePath) === resolvedDir && filePath.startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));
  }

  readJson<T>(filePath: string): T {
    const value = this.files.get(path.resolve(filePath));
    if (value === undefined) {
      throw new Error(`Missing JSON fixture for ${filePath}`);
    }
    return structuredClone(value) as T;
  }

  writeJson(filePath: string, data: unknown): void {
    const resolvedPath = path.resolve(filePath);
    this.ensureDir(path.dirname(resolvedPath));
    this.files.set(resolvedPath, structuredClone(data));
  }

  removeJson(filePath: string): void {
    this.files.delete(path.resolve(filePath));
  }
}

test("json storage backend replacement drives store persistence reads and writes", () => {
  const previousBackend = getJsonStorageBackend();
  const memoryBackend = new MemoryJsonStorageBackend();
  setJsonStorageBackend(memoryBackend);

  try {
    assert.equal(getJsonStorageBackendKind(), "memory-test");

    const nodeRuns: NodeRunRecord[] = [
      {
        node_run_id: "node-run-002",
        run_id: "run-storage-test",
        status: "completed",
        progress: {
          percent: 100,
          message: "Done",
          updated_at: "2026-07-07T00:00:00.000Z",
        },
        attempt: 1,
        started_at: "2026-07-07T00:00:00.000Z",
        finished_at: "2026-07-07T00:01:00.000Z",
      },
      {
        node_run_id: "node-run-001",
        run_id: "run-storage-test",
        status: "running",
        progress: {
          percent: 25,
          message: "Working",
          updated_at: "2026-07-07T00:00:30.000Z",
        },
        attempt: 0,
        started_at: "2026-07-07T00:00:00.000Z",
        finished_at: null,
      },
    ];
    saveNodeRuns("run-storage-test", nodeRuns);

    assert.deepEqual(
      listNodeRuns("run-storage-test").map((record) => record.node_run_id),
      ["node-run-001", "node-run-002"],
    );
    assert.equal(
      getNodeRun("run-storage-test", "node-run-002")?.status,
      "completed",
    );
    assert.deepEqual(listNodeRuns("missing-run"), []);
    assert.equal(getNodeRun("run-storage-test", "missing-node"), null);

    const laterEvent = appendRunEvent({
      run_id: "run-storage-test",
      type: "node.progress",
      actor_type: "system",
      actor_id: "scheduler",
      payload: { seq: 2 },
      created_at: "2026-07-07T00:02:00.000Z",
    });
    const earlierEvent = appendRunEvent({
      run_id: "run-storage-test",
      type: "node.started",
      actor_type: "system",
      actor_id: "scheduler",
      payload: { seq: 1 },
      created_at: "2026-07-07T00:01:00.000Z",
    });
    const events = listRunEvents("run-storage-test");
    assert.equal(events.length, 2);
    assert.equal(events[0]?.event_id, laterEvent.event_id);
    assert.equal(events[1]?.event_id, earlierEvent.event_id);
    assert.deepEqual(events.map((event) => event.run_sequence), [1, 2]);
    assert.deepEqual(listRunEvents("missing-run"), []);

    const template = createTemplate({
      template_id: "storage-template",
      name: "Storage Template",
      description: "Tests backend replacement.",
      input_schema: {},
      policy: {
        max_parallel_nodes: 1,
        default_timeout_seconds: 300,
        budget_policy: {},
        approval_policy: {},
      },
      nodes: [
        {
          id: "node_a",
          name: "Node A",
          type: "agent_task",
          agent_profile: "backend",
          allowed_skills: ["coding-agent"],
          config: {
            allowed_tools: ["read"],
            output_contract: {},
          },
          retry_policy: {
            max_attempts: 1,
            backoff_seconds: 0,
          },
          timeout_seconds: 300,
          parallelism: 1,
          approval_kind: null,
          human_input_schema: null,
        },
      ],
      edges: [],
      workspace_scope: "default",
      agent_profile_bindings: {
        backend: "backend",
      },
      metadata: {},
    });
    assert.equal(getTemplate(template.template_id)?.template_id, "storage-template");
    assert.deepEqual(
      listTemplates().map((item) => item.template_id),
      ["storage-template"],
    );

    const profileTimestamp = new Date().toISOString();
    getJsonStorageBackend().writeJson(path.join(AGENT_PROFILES_DIR, "backend.json"), {
      profile_id: "backend",
      workspace_id: "default",
      name: "Backend",
      description: "",
      provider_connection_id: null,
      default_skills: ["coding-agent"],
      allowed_tools: ["read"],
      disallowed_skills: [],
      policy_tags: [],
      status: "active",
      metadata: {},
      created_at: profileTimestamp,
      updated_at: profileTimestamp,
    });
    const skill = upsertSkill({
      skill_id: "coding-agent",
      name: "Coding Agent",
      description: "Shared backend skill",
      category: "general",
      allowed_tools: ["read"],
      input_schema: {},
      output_contract: {},
      tags: ["coding"],
      status: "active",
      metadata: {},
    });
    assert.equal(skill.skill_id, "coding-agent");
    assert.deepEqual(
      listLegacyAgentProfiles().map((item) => item.profile_id),
      ["backend"],
    );
    assert.deepEqual(
      listSkills().map((item) => item.skill_id),
      ["coding-agent"],
    );

    const memory = createMemory({
      content: "The storage abstraction keeps memory records backend-independent.",
      kind: "decision",
    });
    const candidate = createMemoryCandidate({
      proposed_memory: {
        content: "Candidate records share the same storage abstraction.",
        kind: "fact",
      },
    });
    const approved = approveMemoryCandidate(candidate.candidate_id);
    assert.equal(approved?.candidate.status, "approved");
    assert.deepEqual(
      listMemories().map((item) => item.memory_id).sort(),
      [memory.memory_id, approved!.memory.memory_id].sort(),
    );

    assert.equal(
      memoryBackend.exists(path.join(NODE_RUNS_DIR, "run-storage-test", "node-run-001.json")),
      true,
    );
    assert.equal(
      memoryBackend.exists(path.join(TEMPLATES_DIR, "storage-template.json")),
      true,
    );
    assert.equal(
      memoryBackend.exists(path.join(AGENT_PROFILES_DIR, "backend.json")),
      true,
    );
    assert.equal(
      memoryBackend.exists(path.join(SKILLS_DIR, "coding-agent.json")),
      true,
    );
    assert.equal(
      memoryBackend.exists(path.join(MEMORIES_DIR, "default", `${memory.memory_id}.json`)),
      true,
    );
    assert.equal(
      memoryBackend.exists(path.join(MEMORY_CANDIDATES_DIR, "default", `${candidate.candidate_id}.json`)),
      true,
    );
  } finally {
    setJsonStorageBackend(previousBackend);
  }
});

test("json storage backend factory is explicit about unsupported database backends", () => {
  assert.equal(createJsonStorageBackend("file-json").kind, "file-json");
  assert.equal(createJsonStorageBackend("file").kind, "file-json");
  assert.equal(createJsonStorageBackend("sqlite").kind, "sqlite");
  assert.equal(createJsonStorageBackend("db").kind, "sqlite");
  assert.throws(() => createJsonStorageBackend("postgres"), /Supported backends are file-json and sqlite/);
});

test("json storage snapshots export and import nested store records", () => {
  const previousBackend = getJsonStorageBackend();
  const sourceBackend = new MemoryJsonStorageBackend();
  setJsonStorageBackend(sourceBackend);

  try {
    saveNodeRuns("run-snapshot-test", [
      {
        node_run_id: "node-run-snapshot-001",
        run_id: "run-snapshot-test",
        status: "ready",
        progress: {
          percent: 0,
          message: "Ready",
          updated_at: "2026-07-07T00:00:00.000Z",
        },
        attempt: 0,
        started_at: null,
        finished_at: null,
      },
    ]);
    const event = appendRunEvent({
      run_id: "run-snapshot-test",
      node_run_id: "node-run-snapshot-001",
      type: "node.ready",
      actor_type: "system",
      actor_id: "scheduler",
      payload: { snapshot: true },
      created_at: "2026-07-07T00:00:01.000Z",
    });
    sourceBackend.writeJson(path.join(RUN_ROUTES_DIR, "run-snapshot-test.json"), {
      run_id: "run-snapshot-test",
      route_id: "template:snapshot@1",
    });
    sourceBackend.writeJson(path.join(RUN_PLAN_INITIAL_DIR, "run-snapshot-test.json"), {
      run_id: "run-snapshot-test",
      initial: true,
    });
    sourceBackend.writeJson(
      path.join(EVALUATION_SNAPSHOTS_DIR, "run-snapshot-test", "digest.json"),
      { snapshot_id: "snapshot:run-snapshot-test:digest" },
    );
    sourceBackend.writeJson(
      path.join(SCORECARDS_DIR, "run-snapshot-test", "scorecard.json"),
      { scorecard_id: "scorecard:run-snapshot-test:digest" },
    );
    sourceBackend.writeJson(path.join(DATA_DIR, ".control-plane.lock", "owner.json"), {
      pid: 1234,
      port: 4010,
    });

    const snapshot = exportJsonStorageSnapshot();
    assert.equal(snapshot.source_backend_kind, "memory-test");
    assert.equal(
      snapshot.entries.some((entry) => entry.relative_path.startsWith(".control-plane.lock/")),
      false,
    );
    assert.ok(
      snapshot.entries.some(
        (entry) =>
          entry.relative_path ===
          "node-runs/run-snapshot-test/node-run-snapshot-001.json",
      ),
    );
    for (const relativePath of [
      "run-routes/run-snapshot-test.json",
      "run-plan-initial/run-snapshot-test.json",
      "evaluation-snapshots/run-snapshot-test/digest.json",
      "scorecards/run-snapshot-test/scorecard.json",
    ]) {
      assert.ok(snapshot.entries.some((entry) => entry.relative_path === relativePath));
    }
    assert.ok(
      snapshot.entries.some(
        (entry) =>
          entry.relative_path ===
          `events/run-snapshot-test/${event.event_id}.json`,
      ),
    );

    const targetBackend = new MemoryJsonStorageBackend();
    setJsonStorageBackend(targetBackend);
    const importResult = importJsonStorageSnapshot(snapshot);
    assert.throws(
      () => importJsonStorageSnapshot({
        ...snapshot,
        entries: [{ relative_path: ".control-plane.lock/owner.json", data: {} }],
      }),
      /runtime lease files are not importable/,
    );

    assert.equal(importResult.written_entries, snapshot.entries.length);
    assert.equal(
      getNodeRun("run-snapshot-test", "node-run-snapshot-001")?.status,
      "ready",
    );
    assert.deepEqual(
      listRunEvents("run-snapshot-test").map((item) => item.event_id),
      [event.event_id],
    );
    assert.equal(
      targetBackend.exists(
        path.join(EVALUATION_SNAPSHOTS_DIR, "run-snapshot-test", "digest.json"),
      ),
      true,
    );
    assert.equal(
      targetBackend.exists(path.join(SCORECARDS_DIR, "run-snapshot-test", "scorecard.json")),
      true,
    );
  } finally {
    setJsonStorageBackend(previousBackend);
  }
});

test("sqlite storage backend round-trips snapshot-imported records through store APIs", () => {
  const previousBackend = getJsonStorageBackend();
  const previousStorageBackendEnv = process.env.MY_MATE_STORAGE_BACKEND;
  const previousSqlitePathEnv = process.env.MY_MATE_SQLITE_PATH;
  const previousDataDir = DATA_DIR;

  resetTestRoot();
  const testDataDir = DATA_DIR;
  const sqlitePath = path.join(testDataDir, "_storage", "control-plane.sqlite3");

  try {
    const fileBackend = createJsonStorageBackend("file-json");
    setJsonStorageBackend(fileBackend);

    saveNodeRuns("run-sqlite-test", [
      {
        node_run_id: "node-run-sqlite-001",
        run_id: "run-sqlite-test",
        status: "running",
        progress: {
          percent: 50,
          message: "Halfway",
          updated_at: "2026-07-07T00:00:30.000Z",
        },
        attempt: 0,
        started_at: "2026-07-07T00:00:00.000Z",
        finished_at: null,
      },
    ]);
    const event = appendRunEvent({
      run_id: "run-sqlite-test",
      node_run_id: "node-run-sqlite-001",
      type: "node.progress",
      actor_type: "system",
      actor_id: "scheduler",
      payload: { percent: 50 },
      created_at: "2026-07-07T00:00:30.000Z",
    });
    createTemplate({
      template_id: "sqlite-template",
      name: "SQLite Template",
      description: "Verifies sqlite storage import",
      input_schema: {},
      policy: {
        max_parallel_nodes: 1,
        default_timeout_seconds: 300,
        budget_policy: {},
        approval_policy: {},
      },
      nodes: [],
      edges: [],
      workspace_scope: "default",
      agent_profile_bindings: {},
      metadata: {},
    });
    const sqliteMemory = createMemory({
      content: "Memory records survive file-to-SQLite storage migration.",
      kind: "fact",
    });

    const snapshot = exportJsonStorageSnapshot();
    assert.ok(fs.existsSync(path.join(testDataDir, "node-runs", "run-sqlite-test", "node-run-sqlite-001.json")));

    process.env.MY_MATE_STORAGE_BACKEND = "sqlite";
    process.env.MY_MATE_SQLITE_PATH = sqlitePath;
    setJsonStorageBackend(null);

    const importResult = importJsonStorageSnapshot(snapshot);
    assert.equal(importResult.written_entries, snapshot.entries.length);
    assert.equal(getJsonStorageBackendKind(), "sqlite");
    assert.ok(fs.existsSync(sqlitePath));
    assert.equal(
      getNodeRun("run-sqlite-test", "node-run-sqlite-001")?.status,
      "running",
    );
    assert.deepEqual(
      listNodeRuns("run-sqlite-test").map((record) => record.node_run_id),
      ["node-run-sqlite-001"],
    );
    assert.deepEqual(
      listRunEvents("run-sqlite-test").map((item) => item.event_id),
      [event.event_id],
    );
    assert.deepEqual(
      listTemplates().map((item) => item.template_id),
      ["sqlite-template"],
    );
    assert.equal(
      getTemplate("sqlite-template")?.description,
      "Verifies sqlite storage import",
    );
    assert.deepEqual(
      listMemories().map((item) => item.memory_id),
      [sqliteMemory.memory_id],
    );
    const sqliteBackend = getJsonStorageBackend();
    const removablePath = path.join(testDataDir, "observability-dirty", "run-sqlite-test.json");
    sqliteBackend.writeJson(removablePath, { dirty: true });
    assert.equal(sqliteBackend.exists(removablePath), true);
    sqliteBackend.removeJson(removablePath);
    assert.equal(sqliteBackend.exists(removablePath), false);
  } finally {
    if (previousStorageBackendEnv === undefined) {
      delete process.env.MY_MATE_STORAGE_BACKEND;
    } else {
      process.env.MY_MATE_STORAGE_BACKEND = previousStorageBackendEnv;
    }
    if (previousSqlitePathEnv === undefined) {
      delete process.env.MY_MATE_SQLITE_PATH;
    } else {
      process.env.MY_MATE_SQLITE_PATH = previousSqlitePathEnv;
    }
    overrideDataDir(previousDataDir);
    setJsonStorageBackend(previousBackend);
  }
});

test("file-json migration creates a verified backup and is idempotent", () => {
  const previousBackend = getJsonStorageBackend();
  const previousSqlitePathEnv = process.env.MY_MATE_SQLITE_PATH;
  const previousDataDir = DATA_DIR;
  resetTestRoot();
  const testDataDir = DATA_DIR;
  const sourcePath = path.join(testDataDir, "sessions", "session-migration.json");
  const sqlitePath = path.join(testDataDir, "_storage", "migration.sqlite3");

  try {
    const source = createJsonStorageBackend("file-json");
    source.writeJson(sourcePath, { session_id: "session-migration", title: "迁移验证" });
    process.env.MY_MATE_SQLITE_PATH = sqlitePath;
    const target = createJsonStorageBackend("sqlite");
    const manifest = migratePhysicalFileJsonToSqlite({
      storage: target,
      dataDir: testDataDir,
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });

    assert.equal(manifest.record_count, 1);
    assert.equal(manifest.verified_count, 1);
    assert.deepEqual(target.readJson(sourcePath), { session_id: "session-migration", title: "迁移验证" });
    assert.ok(manifest.backup_relative_path);
    assert.ok(fs.existsSync(path.join(
      testDataDir,
      manifest.backup_relative_path!,
      "records",
      "sessions",
      "session-migration.json",
    )));
    assert.deepEqual(
      migratePhysicalFileJsonToSqlite({ storage: target, dataDir: testDataDir }),
      manifest,
    );
  } finally {
    if (previousSqlitePathEnv === undefined) delete process.env.MY_MATE_SQLITE_PATH;
    else process.env.MY_MATE_SQLITE_PATH = previousSqlitePathEnv;
    overrideDataDir(previousDataDir);
    setJsonStorageBackend(previousBackend);
  }
});

test("file-json storage repeatedly replaces records without leaving temporary files", () => {
  resetTestRoot();
  const backend = createJsonStorageBackend("file-json");
  const storageDir = path.join(DATA_DIR, "atomic-replace-test");
  const filePath = path.join(storageDir, "record.json");

  for (let revision = 1; revision <= 25; revision += 1) {
    backend.writeJson(filePath, { revision });
  }

  assert.deepEqual(backend.readJson(filePath), { revision: 25 });
  backend.removeJson(filePath);
  assert.equal(backend.exists(filePath), false);
  assert.deepEqual(
    fs.readdirSync(storageDir).filter((entry) => entry.endsWith(".tmp")),
    [],
  );
});

test("file-json transaction rolls back every record when a later write fails", () => {
  resetTestRoot();
  const backend = createJsonStorageBackend("file-json");
  const directory = path.join(DATA_DIR, "transaction-fault-test");
  const firstPath = path.join(directory, "first.json");
  const secondPath = path.join(directory, "second.json");
  backend.writeJson(firstPath, { revision: 1 });

  assert.throws(() => backend.transaction!(() => {
    backend.writeJson(firstPath, { revision: 2 });
    assert.deepEqual(backend.readJson(firstPath), { revision: 2 });
    backend.writeJson(secondPath, { unsupported: 1n });
  }), /BigInt/);

  assert.deepEqual(backend.readJson(firstPath), { revision: 1 });
  assert.equal(backend.exists(secondPath), false);
  const journalDirectory = path.join(DATA_DIR, "_storage", "transactions");
  assert.deepEqual(
    fs.existsSync(journalDirectory) ? fs.readdirSync(journalDirectory).filter((entry) => entry.endsWith(".json")) : [],
    [],
  );
});

test("sqlite transaction commits a batch atomically and discards a failed callback", () => {
  const previousSqlitePath = process.env.MY_MATE_SQLITE_PATH;
  resetTestRoot();
  const sqlitePath = path.join(DATA_DIR, "_storage", "transaction.sqlite3");
  process.env.MY_MATE_SQLITE_PATH = sqlitePath;
  try {
    const backend = createJsonStorageBackend("sqlite");
    const directory = path.join(DATA_DIR, "sqlite-transaction-test");
    const firstPath = path.join(directory, "first.json");
    const secondPath = path.join(directory, "second.json");
    backend.transaction!(() => {
      backend.writeJson(firstPath, { revision: 1 });
      backend.writeJson(secondPath, { revision: 1 });
      assert.deepEqual(backend.readJson(firstPath), { revision: 1 });
      assert.deepEqual(backend.listJsonFiles(directory).map((item) => path.basename(item)), ["first.json", "second.json"]);
    });
    assert.deepEqual(backend.readJson(firstPath), { revision: 1 });
    assert.deepEqual(backend.readJson(secondPath), { revision: 1 });

    assert.throws(() => backend.transaction!(() => {
      backend.writeJson(firstPath, { revision: 2 });
      backend.removeJson(secondPath);
      throw new Error("fault injection");
    }), /fault injection/);
    assert.deepEqual(backend.readJson(firstPath), { revision: 1 });
    assert.deepEqual(backend.readJson(secondPath), { revision: 1 });
  } finally {
    if (previousSqlitePath === undefined) delete process.env.MY_MATE_SQLITE_PATH;
    else process.env.MY_MATE_SQLITE_PATH = previousSqlitePath;
  }
});
