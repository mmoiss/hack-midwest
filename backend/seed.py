"""Reset coordinator.db to the demo's starting state: the two contracts, nothing else.

Run from the repo root: python backend/seed.py

Seeds only the `spec` table. It used to also write a fictional story of agents, claims
and events for a populated-looking dashboard, but a real agent reading those rows
through check_conflicts took them for live state (INTEGRATION_TEST.md, finding 1), and
the dashboard then showed activity nobody had performed. Claims and events now only ever
come from real tool calls and hooks. demo-repo/scripts/reset.sh re-establishes the two
claims the scripted demo moment relies on, and wipes everything else.

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

SPEC = [
    ("GET /users/{id}", "backend/api/users.py", ["frontend/src/api/client.ts", "frontend/src/components/UserCard.tsx"], USER_SHAPE),
    ("GET /orders", "backend/api/orders.py", ["frontend/src/api/client.ts", "frontend/src/pages/Orders.tsx"], {"orders": "Order[]"}),
]

# The whole crew's starting claims, matching the rehearsal scenario: aruneem owns the
# users service that sandi's admin-page work will reach into, ogo holds the UserCard
# consumer (the coordinator names the teammate who claimed a consumer file, so without
# ogo's claim the alert says "UserCard.tsx" instead of "ogo"), and matthew builds the
# orders page against the as-yet-unclaimed GET /orders. POST /api/reset (backend/mcp.py)
# re-establishes these; `python backend/seed.py` does not, so a fresh deploy starts with
# no claims until agents declare intent. The names must match the ones TEAM_TOKENS was
# generated with (scripts/make_tokens.py aruneem matthew sandi ogo), or the claims
# resolve to nobody.
DEMO_CLAIMS = [
    ("aruneem", "backend/api/users.py", "Owns GET /users/{id}"),
    ("sandi", "frontend/src/pages/Admin.tsx", "Admin page: search and edit users"),
    ("ogo", "frontend/src/components/UserCard.tsx", "Add first and last name fields to the card"),
    ("matthew", "frontend/src/pages/Orders.tsx", "Orders page: list orders and details"),
]


def seed_contracts(conn: sqlite3.Connection) -> None:
    """Wipe spec/claims/events and write the two contracts. Shared by the CLI and /api/reset."""
    conn.executescript(SCHEMA)
    conn.executemany(
        "INSERT INTO spec VALUES (?, ?, ?, ?)",
        [(c, o, json.dumps(cons), json.dumps(shape, indent=2)) for c, o, cons, shape in SPEC],
    )


def seed_demo_claims(conn: sqlite3.Connection) -> None:
    conn.executemany("INSERT OR REPLACE INTO claims VALUES (?, ?, ?, datetime('now'))", DEMO_CLAIMS)


if __name__ == "__main__":
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")  # lets the dashboard read while Python writes
    seed_contracts(conn)
    conn.commit()
    conn.close()
    print(f"Seeded {DB_PATH}: {len(SPEC)} spec rows; claims and events cleared.")
