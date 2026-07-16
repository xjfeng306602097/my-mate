import json
import os
import sys


def serialize(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [serialize(item) for item in value]
    if hasattr(value, "__dict__"):
        return serialize(vars(value))
    return str(value)


def graph(request):
    from mempalace.knowledge_graph import KnowledgeGraph
    palace_path = os.path.abspath(request["palace_path"])
    os.makedirs(palace_path, exist_ok=True)
    return KnowledgeGraph(db_path=os.path.join(palace_path, "knowledge_graph.db"))


def status(request):
    kg = graph(request)
    return {
        "available": True,
        "implementation": type(kg).__name__,
        "database_path": os.path.join(os.path.abspath(request["palace_path"]), "knowledge_graph.db"),
    }


def sync(request):
    kg = graph(request)
    triple = request["triple"]
    kg.add_triple(
        triple["subject"],
        triple["predicate"],
        triple["object"],
        valid_from=triple.get("valid_from"),
    )
    return {"written": 1}


def invalidate(request):
    kg = graph(request)
    triple = request["triple"]
    for name in ("invalidate_triple", "end_triple", "remove_triple"):
        method = getattr(kg, name, None)
        if not callable(method):
            continue
        try:
            method(triple["subject"], triple["predicate"], triple["object"])
            return {"invalidated": 1, "method": name}
        except TypeError:
            continue
    return {"invalidated": 0, "method": None}


def query(request):
    kg = graph(request)
    entity = request["entity"]
    as_of = request.get("as_of")
    for name in ("query_entity", "get_entity_relations", "query", "search"):
        method = getattr(kg, name, None)
        if not callable(method):
            continue
        try:
            result = method(entity, as_of=as_of) if as_of else method(entity)
            return {"method": name, "result": serialize(result)}
        except TypeError:
            try:
                result = method(entity)
                return {"method": name, "result": serialize(result)}
            except TypeError:
                continue
    raise RuntimeError("Installed MemPalace does not expose a supported entity query method.")


def main():
    request = json.load(sys.stdin)
    action = request.get("action", "status")
    if action == "status":
        result = status(request)
    elif action == "sync":
        result = sync(request)
    elif action == "invalidate":
        result = invalidate(request)
    elif action == "query":
        result = query(request)
    else:
        raise RuntimeError("Unsupported MemPalace action.")
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
