import json
import math
import os
import re
import sqlite3
import sys
from collections import Counter


SCHEMA_VERSION = "1"


def ensure_schema(connection):
    connection.execute(
        "CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_documents (
          id INTEGER PRIMARY KEY,
          memory_id TEXT NOT NULL UNIQUE,
          version INTEGER NOT NULL,
          workspace_id TEXT NOT NULL,
          scope_kind TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          sensitivity TEXT NOT NULL,
          status TEXT NOT NULL,
          content TEXT NOT NULL,
          tags TEXT NOT NULL,
          importance REAL NOT NULL,
          confidence REAL NOT NULL,
          updated_at TEXT NOT NULL,
          digest TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, tags, content='memory_documents', content_rowid='id', tokenize='unicode61')"
    )
    connection.execute(
        "INSERT OR REPLACE INTO memory_meta(key, value) VALUES ('schema_version', ?)",
        (SCHEMA_VERSION,),
    )


def reset_schema(connection):
    connection.execute("DROP TABLE IF EXISTS memory_fts")
    connection.execute("DROP TABLE IF EXISTS memory_documents")
    connection.execute("DROP TABLE IF EXISTS memory_meta")
    ensure_schema(connection)


def journal_records(journal_path):
    if not os.path.exists(journal_path):
        return []
    records = []
    with open(journal_path, "r", encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def sync_journal(connection, records):
    row = connection.execute(
        "SELECT value FROM memory_meta WHERE key = 'journal_line_count'"
    ).fetchone()
    indexed_count = int(row[0]) if row else 0
    if indexed_count > len(records):
        reset_schema(connection)
        indexed_count = 0
    for record in records[indexed_count:]:
        existing = connection.execute(
            "SELECT id FROM memory_documents WHERE memory_id = ?", (record["memory_id"],)
        ).fetchone()
        if existing:
            connection.execute("DELETE FROM memory_fts WHERE rowid = ?", (existing[0],))
            connection.execute("DELETE FROM memory_documents WHERE id = ?", (existing[0],))
        cursor = connection.execute(
            """
            INSERT INTO memory_documents
              (memory_id, version, workspace_id, scope_kind, scope_id, kind,
               sensitivity, status, content, tags, importance, confidence,
               updated_at, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["memory_id"], int(record["version"]), record["workspace_id"],
                record["scope_kind"], record["scope_id"], record["kind"],
                record["sensitivity"], record["status"], record["content"],
                " ".join(record.get("tags", [])), float(record.get("importance", 0.5)),
                float(record.get("confidence", 0.5)), record["updated_at"], record["digest"],
            ),
        )
        if record["status"] == "active":
            connection.execute(
                "INSERT INTO memory_fts(rowid, content, tags) VALUES (?, ?, ?)",
                (cursor.lastrowid, record["content"], " ".join(record.get("tags", []))),
            )
    connection.execute(
        "INSERT OR REPLACE INTO memory_meta(key, value) VALUES ('journal_line_count', ?)",
        (str(len(records)),),
    )


def normalized_text(value):
    return re.sub(r"\s+", " ", value.lower()).strip()


def ngrams(value):
    normalized = normalized_text(value)
    compact = re.sub(r"\s+", "", normalized)
    grams = Counter()
    for word in re.findall(r"[\w-]+", normalized, flags=re.UNICODE):
        grams["w:" + word] += 2
    width = 2 if re.search(r"[\u3400-\u9fff\uf900-\ufaff]", compact) else 3
    if len(compact) < width:
        if compact:
            grams["c:" + compact] += 1
    else:
        for index in range(len(compact) - width + 1):
            grams["c:" + compact[index:index + width]] += 1
    return grams


def cosine(left, right):
    if not left or not right:
        return 0.0
    dot = sum(value * right.get(key, 0) for key, value in left.items())
    if dot <= 0:
        return 0.0
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def fts_query(value):
    terms = re.findall(r"[\w-]+", value, flags=re.UNICODE)
    return " OR ".join('"' + term.replace('"', '""') + '"' for term in terms[:20])


def visible_where(request):
    clauses = [
        "workspace_id = ?",
        "status = 'active'",
        "sensitivity <> 'restricted'",
        "(scope_kind <> 'user' OR scope_id = ?)",
        "(sensitivity <> 'private' OR (scope_kind = 'user' AND scope_id = ?))",
    ]
    values = [request["workspace_id"], request["principal_id"], request["principal_id"]]
    if request.get("scope_kind"):
        clauses.append("scope_kind = ?")
        values.append(request["scope_kind"])
    if request.get("scope_id"):
        clauses.append("scope_id = ?")
        values.append(request["scope_id"])
    if request.get("kind"):
        clauses.append("kind = ?")
        values.append(request["kind"])
    return " AND ".join(clauses), values


def search(connection, request):
    where_sql, values = visible_where(request)
    query = request.get("query", "").strip()
    limit = max(1, min(500, int(request.get("limit", 20))))
    rows = connection.execute(
        "SELECT memory_id, version, content, tags, importance, confidence, updated_at, digest "
        "FROM memory_documents WHERE " + where_sql,
        values,
    ).fetchall()
    if not query:
        rows.sort(key=lambda row: row[6], reverse=True)
        return [
            {
                "memory_id": row[0], "version": row[1], "digest": row[7],
                "lexical_score": 0.0, "semantic_score": 0.0,
                "fused_score": 0.0, "lexical_rank": None, "semantic_rank": None,
                "matched_by": [],
            }
            for row in rows[:limit]
        ]

    lexical = {}
    normalized_query = normalized_text(query)
    fts = fts_query(query)
    if fts:
        try:
            fts_rows = connection.execute(
                "SELECT d.memory_id, -bm25(memory_fts) FROM memory_fts "
                "JOIN memory_documents d ON d.id = memory_fts.rowid "
                "WHERE memory_fts MATCH ? AND " + where_sql,
                [fts] + values,
            ).fetchall()
            lexical.update({row[0]: max(0.0, float(row[1])) for row in fts_rows})
        except sqlite3.OperationalError:
            pass
    semantic = {}
    query_grams = ngrams(query)
    for row in rows:
        memory_id, _, content, tags, _, _, _, _ = row
        haystack = normalized_text(content + " " + tags)
        phrase_score = 2.0 + haystack.count(normalized_query) if normalized_query in haystack else 0.0
        token_overlap = sum(1 for token in normalized_query.split() if token and token in haystack)
        lexical[memory_id] = max(lexical.get(memory_id, 0.0), phrase_score + token_overlap * 0.2)
        semantic[memory_id] = cosine(query_grams, ngrams(content + " " + tags))

    lexical_order = [key for key, score in sorted(lexical.items(), key=lambda item: item[1], reverse=True) if score > 0]
    semantic_order = [key for key, score in sorted(semantic.items(), key=lambda item: item[1], reverse=True) if score >= 0.08]
    lexical_rank = {key: index + 1 for index, key in enumerate(lexical_order)}
    semantic_rank = {key: index + 1 for index, key in enumerate(semantic_order)}
    row_map = {row[0]: row for row in rows}
    hits = []
    for memory_id, row in row_map.items():
        left_rank = lexical_rank.get(memory_id)
        right_rank = semantic_rank.get(memory_id)
        fused = (1.0 / (60 + left_rank) if left_rank else 0.0) + (1.0 / (60 + right_rank) if right_rank else 0.0)
        if fused <= 0:
            continue
        matched_by = []
        if left_rank:
            matched_by.append("lexical")
        if right_rank:
            matched_by.append("ngram")
        hits.append({
            "memory_id": memory_id,
            "version": row[1],
            "digest": row[7],
            "lexical_score": round(lexical.get(memory_id, 0.0), 8),
            "semantic_score": round(semantic.get(memory_id, 0.0), 8),
            "fused_score": round(fused, 8),
            "lexical_rank": left_rank,
            "semantic_rank": right_rank,
            "matched_by": matched_by,
        })
    hits.sort(key=lambda hit: (hit["fused_score"], hit["semantic_score"], hit["lexical_score"]), reverse=True)
    return hits[:limit]


def status(connection, records, request):
    workspace_id = request.get("workspace_id")
    indexed = connection.execute(
        "SELECT COUNT(*) FROM memory_documents WHERE workspace_id = ?", (workspace_id,)
    ).fetchone()[0]
    active = connection.execute(
        "SELECT COUNT(*) FROM memory_documents WHERE workspace_id = ? AND status = 'active'", (workspace_id,)
    ).fetchone()[0]
    journal_count = sum(1 for record in records if record.get("workspace_id") == workspace_id)
    return {"journal_records": journal_count, "indexed_records": indexed, "active_records": active}


def main():
    request = json.load(sys.stdin)
    db_path = os.path.abspath(request["db_path"])
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    connection = sqlite3.connect(db_path)
    try:
        ensure_schema(connection)
        records = journal_records(request["journal_path"])
        sync_journal(connection, records)
        action = request.get("action", "search")
        response = status(connection, records, request)
        if action == "search":
            response["hits"] = search(connection, request)
        connection.commit()
        print(json.dumps({"ok": True, **response}, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
