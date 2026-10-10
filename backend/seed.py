"""Reset coordinator.db to the demo's starting state: fake agents, claims, and events.

Run from the repo root: python -m backend.seed
DB_PATH overrides the default repository-root coordinator.db.
"""

import json
import os
import sqlite3
from pathlib import Path

DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).resolve().parent.parent / "coordinator.db"))

# Same schema as mcp.py's init_db (not imported, so seeding doesn't need fastmcp).
SCHEMA = """
CREATE TABLE IF NOT EXISTS spec (contract TEXT PRIMARY KEY, owner TEXT NOT NULL, consumers TEXT NOT NULL, shape TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (agent TEXT NOT NULL, file TEXT NOT NULL, summary TEXT, claimed_at TEXT NOT NULL, PRIMARY KEY (agent, file));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), agent TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
DELETE FROM spec; DELETE FROM claims; DELETE FROM events; DELETE FROM sqlite_sequence;
"""

USER_SHAPE = {"id": "int", "name": "string", "email": "string"}
USER_SHAPE_SPLIT = {"id": "int", "first_name": "string", "last_name": "string", "email": "string"}

SPEC = [
    ("GET /users/{id}", "backend/api/users.py", ["frontend/src/api/client.ts", "frontend/src/components/UserCard.tsx"], USER_SHAPE),
    ("GET /orders", "backend/api/orders.py", ["frontend/src/api/client.ts", "frontend/src/pages/Orders.tsx"], {"orders": "Order[]"}),
]

CLAIMS = [
    ("alice", "backend/api/users.py", "Return first_name/last_name"),
    ("bob", "frontend/src/components/UserCard.tsx", "Render user name in card"),
    ("carol", "backend/api/orders.py", "Order join lives here instead"),
]

EVENTS = [
    ("alice", "declare_intent", {"files": ["backend/api/users.py"], "summary": "Return first_name/last_name"}),
    ("alice", "edit", {"file": "backend/api/users.py", "diff": '-"name": user.name\n+"first_name": user.first_name\n+"last_name": user.last_name'}),
    ("bob", "check_conflicts", {"files": ["frontend/src/components/UserCard.tsx"]}),
    ("bob", "declare_intent", {"files": ["frontend/src/components/UserCard.tsx"], "summary": "Render user name in card"}),
    ("bob", "get_spec", {"path": "frontend/src/components/UserCard.tsx"}),
    ("bob", "edit", {"file": "frontend/src/components/UserCard.tsx", "diff": ""}),
    ("alice", "propose_spec_change", {
        "entry": "GET /users/{id}",
        "change": json.dumps(USER_SHAPE_SPLIT, indent=2),
        "reason": "Needed for localized greetings.",
    }),
    ("coordinator", "alert", {
        "contract": "GET /users/{id}",
        "summary": "Bob's UserCard reads `user.name`, which Alice's pending contract change removes.",
        "affected": ["alice", "bob"],
        "suggested_fix": "Notify Bob to render first_name + last_name before merging.",
    }),
    ("carol", "edit", {"file": "backend/api/orders.py", "diff": '-return {"orders": orders}\n+return orders'}),
    ("coordinator", "alert", {
        "contract": "GET /orders",
        "summary": "Carol's orders response removes the orders envelope expected by the Orders page and API client.",
        "affected": ["carol"],
        "suggested_fix": "Restore the orders envelope or propose a contract change before updating consumers.",
    }),
    ("carol", "declare_intent", {"files": ["backend/api/orders.py"], "summary": "Order join lives here instead"}),
    ("carol", "edit", {"file": "backend/api/orders.py", "diff": ""}),
]

if __name__ == "__main__":
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")  # lets the dashboard read while Python writes
    conn.executescript(SCHEMA)
    conn.executemany(
        "INSERT INTO spec VALUES (?, ?, ?, ?)",
        [(c, o, json.dumps(cons), json.dumps(shape, indent=2)) for c, o, cons, shape in SPEC],
    )
    conn.executemany("INSERT INTO claims VALUES (?, ?, ?, datetime('now'))", CLAIMS)
    specs = {contract: (owner, consumers) for contract, owner, consumers, _ in SPEC}
    edits = {}
    for agent, event_type, payload in EVENTS:
        payload = dict(payload)
        if event_type == "alert":
            owner, consumers = specs[payload["contract"]]
            payload.update(owner=owner, consumers=consumers, edit_id=edits[owner])
        cursor = conn.execute(
            "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
            (agent, event_type, json.dumps(payload)),
        )
        if event_type == "edit":
            edits[payload["file"]] = cursor.lastrowid
    conn.commit()
    conn.close()
    print(f"Seeded {DB_PATH}: {len(SPEC)} spec, {len(CLAIMS)} claims, {len(EVENTS)} events.")
