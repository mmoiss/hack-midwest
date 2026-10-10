import json
import os
import sqlite3

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers

mcp = FastMCP("TeamAgentCoordinator")
DB_PATH = "coordinator.db"

# token -> {"name": ..., "color": ...}, e.g. TEAM_TOKENS='{"tok_abc": {"name": "alice", "color": "#e06c75"}}'
TEAM_TOKENS: dict = json.loads(os.environ.get("TEAM_TOKENS", "{}"))


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS spec (
            contract TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            consumers TEXT NOT NULL,
            shape TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            agent TEXT NOT NULL,
            file TEXT NOT NULL,
            summary TEXT,
            claimed_at TEXT NOT NULL,
            PRIMARY KEY (agent, file)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL DEFAULT (datetime('now')),
            agent TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def caller_identity() -> tuple[str, str]:
    """Resolve the calling agent's name and color from its bearer token. Never trust a caller-supplied name."""
    headers = get_http_headers(include={"authorization"})
    token = headers.get("authorization", "").removeprefix("Bearer ").strip()
    identity = TEAM_TOKENS.get(token)
    if not identity:
        raise ValueError("Unknown or missing bearer token.")
    return identity["name"], identity["color"]


def log_event(agent: str, event_type: str, payload: dict) -> None:
    conn = get_db()
    conn.execute(
        "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
        (agent, event_type, json.dumps(payload)),
    )
    conn.commit()
    conn.close()


@mcp.tool()
def declare_intent(files: list[str], summary: str) -> str:
    """Claim the files you are about to work on, so other agents see it before they collide with you."""
    agent, _ = caller_identity()
    conn = get_db()
    for f in files:
        conn.execute(
            """INSERT INTO claims (agent, file, summary, claimed_at) VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(agent, file) DO UPDATE SET summary = ?, claimed_at = datetime('now')""",
            (agent, f, summary, summary),
        )
    conn.commit()
    conn.close()
    log_event(agent, "declare_intent", {"files": files, "summary": summary})
    return f"Claimed {len(files)} file(s) for {agent}."


@mcp.tool()
def check_conflicts(files: list[str]) -> str:
    """Check whether other agents have claimed these files, or there is an open alert naming you."""
    agent, _ = caller_identity()
    conn = get_db()
    placeholders = ",".join("?" for _ in files)
    claim_rows = conn.execute(
        f"SELECT agent, file, summary FROM claims WHERE file IN ({placeholders}) AND agent != ?",
        (*files, agent),
    ).fetchall()
    alert_rows = conn.execute(
        "SELECT payload FROM events WHERE type = 'alert' ORDER BY id DESC LIMIT 50"
    ).fetchall()
    conn.close()
    log_event(agent, "check_conflicts", {"files": files})

    lines = [f"{row['agent']} is working on {row['file']}: {row['summary']}" for row in claim_rows]
    for row in alert_rows:
        alert = json.loads(row["payload"])
        if agent in alert.get("affected", []):
            lines.append(f"Open alert for you: {alert.get('summary')}")

    return "\n".join(lines) if lines else "No active conflicts or alerts for these files."


@mcp.tool()
def get_spec(path: str) -> str:
    """Read the contract a file owns or depends on."""
    agent, _ = caller_identity()
    conn = get_db()
    rows = conn.execute("SELECT contract, owner, consumers, shape FROM spec").fetchall()
    conn.close()
    log_event(agent, "get_spec", {"path": path})

    matches = [row for row in rows if row["owner"] == path or path in json.loads(row["consumers"])]
    if not matches:
        return f"No spec entry involves {path}."
    return "\n".join(f"{row['contract']} (owner: {row['owner']}): {row['shape']}" for row in matches)


@mcp.tool()
def propose_spec_change(entry: str, change: str, reason: str) -> str:
    """Ask to change a contract's agreed shape. The spec does not change until a human accepts this."""
    agent, _ = caller_identity()
    log_event(agent, "propose_spec_change", {"entry": entry, "change": change, "reason": reason})
    return f"Proposal for {entry} logged. Waiting on a human to accept it before the spec changes."


if __name__ == "__main__":
    init_db()
    mcp.run(transport="http", host="0.0.0.0", port=8000)
