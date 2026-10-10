"""Reset coordinator.db to the demo's starting state: fake agents, claims, and events.

Run from backend/: python seed.py

In the container the database lives on a mounted volume, so DB_PATH is set there and
must be honoured here too. Hardcoding the relative name seeded /app/coordinator.db
while the server kept reading /app/data/coordinator.db — the seed appeared to succeed
and the spec table stayed empty, so no edit ever reached the coordinator.
"""

import json
import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "coordinator.db")

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
    ("alice", "edit", {"file": "backend/api/users.py", "diff": ""}),
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
        "summary": "Bob's UserCard reads `user.name`, which Alice's pending contract change removes.",
        "affected": ["alice", "bob"],
        "suggested_fix": "Notify Bob to render first_name + last_name before merging.",
    }),
    ("carol", "edit", {"file": "backend/api/users.py", "diff": ""}),
    ("coordinator", "alert", {
        "summary": "Carol started editing users.py, which Alice has claimed.",
        "affected": ["alice", "carol"],
        "suggested_fix": "Carol should wait for Alice, or move the order join into orders.py.",
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
    conn.executemany(
        "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
        [(a, t, json.dumps(p)) for a, t, p in EVENTS],
    )
    conn.commit()
    conn.close()
    print(f"Seeded {DB_PATH}: {len(SPEC)} spec, {len(CLAIMS)} claims, {len(EVENTS)} events.")
