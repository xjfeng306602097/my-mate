import json
import os
import re
import sqlite3
import sys


def reset_schema(connection):
    connection.execute("DROP TABLE IF EXISTS recall_fts")
    connection.execute("DROP TABLE IF EXISTS recall_documents")
    connection.execute("DROP TABLE IF EXISTS recall_meta")
    ensure_schema(connection)


def ensure_schema(connection):
    connection.execute(
        "CREATE TABLE IF NOT EXISTS recall_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS recall_documents (
          id INTEGER PRIMARY KEY,
          message_id TEXT NOT NULL UNIQUE,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          session_title TEXT NOT NULL,
          role TEXT NOT NULL,
          kind TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(text, content='recall_documents', content_rowid='id', tokenize='unicode61')"
    )


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
        "SELECT value FROM recall_meta WHERE key = 'journal_line_count'"
    ).fetchone()
    indexed_count = int(row[0]) if row else 0
    if indexed_count > len(records):
        reset_schema(connection)
        indexed_count = 0
    for record in records[indexed_count:]:
        existing = connection.execute(
            "SELECT id FROM recall_documents WHERE message_id = ?", (record["message_id"],)
        ).fetchone()
        if existing:
            connection.execute("DELETE FROM recall_fts WHERE rowid = ?", (existing[0],))
            connection.execute("DELETE FROM recall_documents WHERE id = ?", (existing[0],))
        cursor = connection.execute(
            """
            INSERT INTO recall_documents
              (message_id, workspace_id, session_id, session_title, role, kind, text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["message_id"], record["workspace_id"], record["session_id"],
                record["session_title"], record["role"], record["kind"],
                record["text"], record["created_at"],
            ),
        )
        connection.execute(
            "INSERT INTO recall_fts(rowid, text) VALUES (?, ?)",
            (cursor.lastrowid, record["text"]),
        )
    connection.execute(
        "INSERT OR REPLACE INTO recall_meta(key, value) VALUES ('journal_line_count', ?)",
        (str(len(records)),),
    )


def contains_cjk(value):
    return re.search(r"[\u3400-\u9fff\uf900-\ufaff]", value) is not None


def fts_query(value):
    terms = re.findall(r"[\w-]+", value, flags=re.UNICODE)
    return " AND ".join('"' + term.replace('"', '""') + '"' for term in terms[:20])


def search(connection, request):
    params = (request["workspace_id"], request["current_session_id"])
    limit = max(1, min(100, int(request.get("limit", 20))))
    query = request["query"].strip()
    if contains_cjk(query):
        rows = connection.execute(
            """
            SELECT message_id, session_id, 1.0 AS score
            FROM recall_documents
            WHERE workspace_id = ? AND session_id <> ? AND instr(lower(text), lower(?)) > 0
            ORDER BY created_at DESC LIMIT ?
            """,
            params + (query, limit),
        ).fetchall()
    else:
        normalized = fts_query(query)
        if not normalized:
            return []
        rows = connection.execute(
            """
            SELECT d.message_id, d.session_id, -bm25(recall_fts) AS score
            FROM recall_fts
            JOIN recall_documents d ON d.id = recall_fts.rowid
            WHERE recall_fts MATCH ? AND d.workspace_id = ? AND d.session_id <> ?
            ORDER BY bm25(recall_fts), d.created_at DESC LIMIT ?
            """,
            (normalized,) + params + (limit,),
        ).fetchall()
    return [
        {"message_id": row[0], "session_id": row[1], "score": float(row[2])}
        for row in rows
    ]


def main():
    request = json.load(sys.stdin)
    db_path = os.path.abspath(request["db_path"])
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    connection = sqlite3.connect(db_path)
    try:
        ensure_schema(connection)
        records = journal_records(request["journal_path"])
        sync_journal(connection, records)
        hits = search(connection, request)
        connection.commit()
        print(json.dumps({"ok": True, "hits": hits}, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
