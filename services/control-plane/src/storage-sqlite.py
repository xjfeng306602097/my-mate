import json
import os
import sqlite3
import sys
from pathlib import PurePosixPath


def fail(message: str, exit_code: int = 1) -> None:
    sys.stderr.write(message)
    sys.exit(exit_code)


def normalize_relative_path(target_path: str) -> str:
    normalized = PurePosixPath(target_path).as_posix().strip("/")
    if normalized in ("", "."):
        return ""
    if normalized.startswith("../") or normalized == "..":
        raise ValueError(f'Invalid storage path "{target_path}"')
    return normalized


def dir_key(relative_path: str) -> str:
    normalized = normalize_relative_path(relative_path)
    if normalized == "":
        return ""
    parent = PurePosixPath(normalized).parent.as_posix()
    return "" if parent == "." else parent


def basename_key(relative_path: str) -> str:
    normalized = normalize_relative_path(relative_path)
    if normalized == "":
        return ""
    return PurePosixPath(normalized).name


def row_path(parent_path: str, name: str) -> str:
    if not parent_path:
        return name
    return f"{parent_path}/{name}"


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS json_records (
          path TEXT PRIMARY KEY,
          parent_path TEXT NOT NULL,
          name TEXT NOT NULL,
          json_text TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS logical_dirs (
          path TEXT PRIMARY KEY,
          parent_path TEXT NOT NULL,
          name TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO logical_dirs(path, parent_path, name)
        VALUES('', '', '')
        """
    )
    connection.commit()


def ensure_dir(connection: sqlite3.Connection, relative_dir: str) -> None:
    normalized = normalize_relative_path(relative_dir)
    current = ""
    if normalized:
        for part in normalized.split("/"):
            next_path = row_path(current, part)
            connection.execute(
                """
                INSERT OR IGNORE INTO logical_dirs(path, parent_path, name)
                VALUES(?, ?, ?)
                """,
                (next_path, current, part),
            )
            current = next_path
    connection.commit()


def exists(connection: sqlite3.Connection, relative_path: str) -> bool:
    normalized = normalize_relative_path(relative_path)
    row = connection.execute(
        "SELECT 1 FROM json_records WHERE path = ?",
        (normalized,),
    ).fetchone()
    return row is not None


def list_dirs(connection: sqlite3.Connection, relative_dir: str) -> list[str]:
    normalized = normalize_relative_path(relative_dir)
    rows = connection.execute(
        """
        SELECT path
        FROM logical_dirs
        WHERE parent_path = ? AND path <> ?
        ORDER BY path
        """,
        (normalized, normalized),
    ).fetchall()
    return [row[0] for row in rows]


def list_json_files(connection: sqlite3.Connection, relative_dir: str) -> list[str]:
    normalized = normalize_relative_path(relative_dir)
    rows = connection.execute(
        """
        SELECT path
        FROM json_records
        WHERE parent_path = ?
        ORDER BY path
        """,
        (normalized,),
    ).fetchall()
    return [row[0] for row in rows]


def read_json(connection: sqlite3.Connection, relative_path: str):
    normalized = normalize_relative_path(relative_path)
    row = connection.execute(
        "SELECT json_text FROM json_records WHERE path = ?",
        (normalized,),
    ).fetchone()
    if row is None:
        raise FileNotFoundError(normalized)
    return json.loads(row[0])


def write_json(connection: sqlite3.Connection, relative_path: str, payload) -> None:
    normalized = normalize_relative_path(relative_path)
    parent = dir_key(normalized)
    ensure_dir(connection, parent)
    connection.execute(
        """
        INSERT INTO json_records(path, parent_path, name, json_text)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          parent_path = excluded.parent_path,
          name = excluded.name,
          json_text = excluded.json_text
        """,
        (
            normalized,
            parent,
            basename_key(normalized),
            json.dumps(payload, ensure_ascii=True, indent=2) + "\n",
        ),
    )
    connection.commit()


def remove_json(connection: sqlite3.Connection, relative_path: str) -> None:
    normalized = normalize_relative_path(relative_path)
    connection.execute("DELETE FROM json_records WHERE path = ?", (normalized,))
    connection.commit()


def absolute_result_paths(paths: list[str], data_dir: str) -> list[str]:
    return [os.path.normpath(os.path.join(data_dir, item)) for item in paths]


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        fail("Missing sqlite storage request payload.")

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"Invalid sqlite storage request JSON: {exc}")

    db_path = request.get("db_path")
    data_dir = request.get("data_dir")
    target_path = request.get("target_path")
    action = request.get("action")
    payload = request.get("payload")

    if not isinstance(db_path, str) or not db_path:
        fail("sqlite storage request missing db_path")
    if not isinstance(data_dir, str) or not data_dir:
        fail("sqlite storage request missing data_dir")
    if not isinstance(target_path, str):
        fail("sqlite storage request missing target_path")
    if not isinstance(action, str):
        fail("sqlite storage request missing action")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    connection = sqlite3.connect(db_path)
    try:
        ensure_schema(connection)
        normalized = normalize_relative_path(target_path)

        if action == "ensure_dir":
            ensure_dir(connection, normalized)
            response = {"ok": True}
        elif action == "exists":
            response = {"ok": True, "exists": exists(connection, normalized)}
        elif action == "list_dirs":
            ensure_dir(connection, normalized)
            response = {
                "ok": True,
                "paths": absolute_result_paths(list_dirs(connection, normalized), data_dir),
            }
        elif action == "list_json_files":
            ensure_dir(connection, normalized)
            response = {
                "ok": True,
                "paths": absolute_result_paths(list_json_files(connection, normalized), data_dir),
            }
        elif action == "read_json":
            response = {"ok": True, "data": read_json(connection, normalized)}
        elif action == "write_json":
            write_json(connection, normalized, payload)
            response = {"ok": True}
        elif action == "remove_json":
            remove_json(connection, normalized)
            response = {"ok": True}
        else:
            response = {"ok": False, "error": f"Unsupported sqlite storage action: {action}"}

        sys.stdout.write(json.dumps(response))
    except Exception as exc:  # pragma: no cover - surfaced to caller
        sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
    finally:
        connection.close()


if __name__ == "__main__":
    main()
