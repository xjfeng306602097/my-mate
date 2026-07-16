import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import {
  getMemoryKnowledgeProviderStatus,
  queryMemoryKnowledgeGraph,
  resetMemoryKnowledgeProviderStateForTests,
} from "../src/memory-knowledge-provider.js";
import { resetMemoryEmbeddingProviderStateForTests } from "../src/memory-embedding-provider.js";
import {
  getMemoryRetrievalIndexStatus,
  memoryRetrievalPathsForTests,
  searchMemoryRetrieval,
} from "../src/memory-retrieval-index.js";
import { createMemory, deleteMemory, updateMemory } from "../src/memory-store.js";
import { getJson, postJson, resetTestRoot, startTestServer, TEST_ROOT } from "./helpers.js";

const EMBEDDING_ENV_KEYS = [
  "MY_MATE_MEMORY_EMBEDDING_PROVIDER",
  "MY_MATE_MEMORY_EMBEDDING_BASE_URL",
  "MY_MATE_MEMORY_EMBEDDING_API_KEY",
  "MY_MATE_MEMORY_EMBEDDING_MODEL",
  "MY_MATE_MEMORY_EMBEDDING_DIMENSIONS",
] as const;

function clearM5Environment(): void {
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
  delete process.env.MY_MATE_MEMORY_KG_PROVIDER;
  delete process.env.MY_MATE_MEMPALACE_PATH;
  delete process.env.MY_MATE_MEMPALACE_PYTHON;
  delete process.env.MY_MATE_MEMPALACE_SYNC_CANONICAL;
  resetMemoryEmbeddingProviderStateForTests();
  resetMemoryKnowledgeProviderStateForTests();
}

test("hybrid memory retrieval supports paraphrase, CJK, privacy, lifecycle changes, and corruption rebuild", async () => {
  clearM5Environment();
  resetTestRoot();
  const outputMemory = createMemory({
    content: "Deployment artifacts must be written into the outputs directory.",
    kind: "convention",
    tags: ["delivery", "workspace"],
  });
  const cjkMemory = createMemory({
    content: "\u751f\u6210\u7684\u62a5\u544a\u5fc5\u987b\u4fdd\u7559\u5b8c\u6574\u4e2d\u6587\u7ffb\u8bd1\u3002",
    kind: "preference",
  });
  createMemory({
    content: "Private owner convention for deployment artifacts.",
    kind: "convention",
    scope_kind: "user",
    scope_id: "another-user",
    sensitivity: "private",
  });
  createMemory({
    content: "Restricted deployment artifact location.",
    kind: "fact",
    sensitivity: "restricted",
  });

  const paraphrase = await searchMemoryRetrieval({
    query: "write deployment artifact to output folder",
    principalId: "memory-owner",
  });
  assert.equal(paraphrase.retrieval, "hybrid_lexical_ngram_v1");
  assert.equal(paraphrase.hits[0]?.memory.memory_id, outputMemory.memory_id);
  assert.ok(paraphrase.hits[0]?.evidence.matched_by.includes("ngram"));
  assert.equal(paraphrase.hits.some((hit) => hit.memory.sensitivity === "restricted"), false);
  assert.equal(paraphrase.hits.some((hit) => hit.memory.scope_id === "another-user"), false);

  const cjk = await searchMemoryRetrieval({
    query: "\u5b8c\u6574\u4e2d\u6587\u7ffb\u8bd1",
    principalId: "memory-owner",
  });
  assert.equal(cjk.hits[0]?.memory.memory_id, cjkMemory.memory_id);

  const updated = updateMemory(outputMemory.memory_id, {
    content: "Current nimbus delivery rule uses the published directory.",
  });
  assert.ok(updated);
  const current = await searchMemoryRetrieval({ query: "nimbus published", principalId: "memory-owner" });
  const currentHit = current.hits.find((hit) => hit.memory.memory_id === outputMemory.memory_id);
  assert.equal(currentHit?.memory.version, updated.version);
  assert.match(currentHit?.memory.content || "", /nimbus/u);

  deleteMemory(cjkMemory.memory_id);
  const afterDelete = await searchMemoryRetrieval({
    query: "\u5b8c\u6574\u4e2d\u6587\u7ffb\u8bd1",
    principalId: "memory-owner",
  });
  assert.equal(afterDelete.hits.some((hit) => hit.memory.memory_id === cjkMemory.memory_id), false);

  const paths = memoryRetrievalPathsForTests();
  fs.writeFileSync(paths.database, "not a sqlite database", "utf-8");
  const recovered = await searchMemoryRetrieval({ query: "nimbus", principalId: "memory-owner" });
  assert.equal(recovered.index_rebuilt, true);
  assert.equal(recovered.hits[0]?.memory.memory_id, outputMemory.memory_id);
  const status = getMemoryRetrievalIndexStatus();
  assert.ok(status.indexed_records >= 4);
  assert.equal(status.embedding.state, "disabled");
});

test("OpenAI-compatible embeddings rerank hybrid results and invalidate cache by fingerprint", async () => {
  clearM5Environment();
  resetTestRoot();
  createMemory({ content: "Alpha release notes use a compact summary.", kind: "convention" });
  createMemory({ content: "Beta incident reports include a detailed timeline.", kind: "convention" });
  let requests = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requests += 1;
      const payload = JSON.parse(body) as { input: string[] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        data: payload.input.map((text, index) => ({
          index,
          embedding: /beta|timeline|incident|retrospective|sequence/iu.test(text) ? [0, 1] : [1, 0],
        })),
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    process.env.MY_MATE_MEMORY_EMBEDDING_PROVIDER = "openai-compatible";
    process.env.MY_MATE_MEMORY_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.MY_MATE_MEMORY_EMBEDDING_MODEL = "embedding-test-v1";
    const first = await searchMemoryRetrieval({ query: "incident timeline", principalId: "owner" });
    assert.equal(first.retrieval, "hybrid_lexical_embedding_v1");
    assert.match(first.hits[0]?.memory.content || "", /Beta/u);
    assert.ok(first.hits[0]?.evidence.matched_by.includes("embedding"));
    const semanticOnly = await searchMemoryRetrieval({ query: "retrospective sequence", principalId: "owner" });
    assert.match(semanticOnly.hits[0]?.memory.content || "", /Beta/u);
    assert.equal(semanticOnly.hits[0]?.evidence.lexical_rank, null);
    const firstFingerprint = getMemoryRetrievalIndexStatus().embedding.fingerprint;
    const requestsAfterFirst = requests;

    await searchMemoryRetrieval({ query: "incident timeline", principalId: "owner" });
    assert.equal(requests, requestsAfterFirst + 1, "only the query vector should be fetched from a warm cache");

    process.env.MY_MATE_MEMORY_EMBEDDING_MODEL = "embedding-test-v2";
    const secondFingerprint = getMemoryRetrievalIndexStatus().embedding.fingerprint;
    assert.notEqual(secondFingerprint, firstFingerprint);
    await searchMemoryRetrieval({ query: "incident timeline", principalId: "owner" });
    assert.ok(requests >= requestsAfterFirst + 3, "a provider fingerprint change rebuilds document vectors");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    clearM5Environment();
  }
});

test("MemPalace provider fails open when its optional Python dependency is missing", () => {
  clearM5Environment();
  resetTestRoot();
  process.env.MY_MATE_MEMORY_KG_PROVIDER = "mempalace";
  process.env.MY_MATE_MEMPALACE_PATH = `${TEST_ROOT}/missing-mempalace-palace`;
  const status = getMemoryKnowledgeProviderStatus();
  assert.equal(status.provider_id, "mempalace");
  assert.equal(status.state, "unavailable");
  const query = queryMemoryKnowledgeGraph({ entity: "workspace:default" });
  assert.equal(query.count, 0);
  assert.equal(query.provider.state, "unavailable");
  clearM5Environment();
});

test("M5 retrieval and provider management APIs expose status, search, and rebuild", async () => {
  clearM5Environment();
  resetTestRoot();
  createMemory({ content: "API hybrid retrieval keeps release evidence searchable.", kind: "fact" });
  const server = await startTestServer();
  try {
    const status = await getJson(`${server.baseUrl}/api/memory-retrieval/status`);
    const search = await postJson(`${server.baseUrl}/api/memory-retrieval/search`, {
      query: "release evidence",
      limit: 5,
    });
    const rebuilt = await postJson(`${server.baseUrl}/api/memory-retrieval/rebuild`, {});
    const knowledge = await getJson(`${server.baseUrl}/api/memory-knowledge/status`);
    assert.equal(status.status, 200);
    assert.equal(search.status, 200);
    assert.equal(search.body.count, 1);
    assert.equal(rebuilt.status, 200);
    assert.ok(rebuilt.body.records >= 1);
    assert.equal(knowledge.body.state, "disabled");
  } finally {
    await server.close();
  }
});
