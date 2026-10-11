"""Team Agent Coordinator — MCP tools, the /events hook route, and shared SQLite state.

Run from the REPO ROOT as a module, never as a script:

    python -m backend.mcp

Running `python backend/mcp.py` puts backend/ at the front of sys.path, so this file
shadows the installed `mcp` package that fastmcp imports internally, and fastmcp dies
with "No module named 'mcp.server'; 'mcp' is not a package". The -m form keeps the repo
root on sys.path instead, so the real package wins.
"""

import json
import os
import sqlite3
import time

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import JSONResponse

mcp = FastMCP("TeamAgentCoordinator")

# Points at the bind-mounted volume in the container so the database survives a redeploy;
# falls back to the working directory for local runs. See compose.yaml.
DB_PATH = os.environ.get("DB_PATH", "coordinator.db")

# token -> {"name": ..., "color": ...}, e.g. TEAM_TOKENS='{"tok_abc": {"name": "alice", "color": "#e06c75"}}'
TEAM_TOKENS: dict = json.loads(os.environ.get("TEAM_TOKENS", "{}"))

# A burst of saves to one file should cost one coordinator call, not one per save.
# In-memory on purpose: a restart forgetting this is harmless.
DEBOUNCE_SECONDS = 5
_last_seen: dict[str, float] = {}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Per-connection, unlike journal_mode, so it has to be set on every connection
    # rather than once in init_db(). Without it a concurrent write fails instead of waiting.
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _ensure_column(conn, table: str, column: str, ddl: str) -> None:
    """Add a column if a database created before it already exists on disk or on the VM."""
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)

    conn = get_db()
    # Stored in the database file, so every later connection inherits it. This is what lets
    # the dashboard's TypeScript server poll `events` while Python is writing to it.
    conn.execute("PRAGMA journal_mode=WAL")
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
            payload TEXT NOT NULL,
            delivered_to TEXT NOT NULL DEFAULT '[]'
        )
    """)
    _ensure_column(conn, "events", "delivered_to", "delivered_to TEXT NOT NULL DEFAULT '[]'")
    conn.commit()
    conn.close()


def resolve_identity(token: str) -> tuple[str, str]:
    """Map a bearer token to (name, color). The only place the token table is read."""
    identity = TEAM_TOKENS.get(token)
    if not identity:
        raise ValueError("Unknown or missing bearer token.")
    return identity["name"], identity["color"]


def _bearer(header_value: str) -> str:
    return header_value.removeprefix("Bearer ").strip()


def caller_identity() -> tuple[str, str]:
    """Identity for MCP tool calls, which reach their headers through FastMCP's context.

    Never trust a caller-supplied name — the token is the identity.
    """
    headers = get_http_headers(include={"authorization"})
    return resolve_identity(_bearer(headers.get("authorization", "")))


def log_event(agent: str, event_type: str, payload: dict) -> None:
    conn = get_db()
    conn.execute(
        "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
        (agent, event_type, json.dumps(payload)),
    )
    conn.commit()
    conn.close()


def resolved_alert_ids(conn) -> set[int]:
    """Ids of `alert` rows a human has marked resolved from the dashboard.

    Resolution is its own event row (type "alert_resolved") rather than a flag on the
    alert, so the log stays append-only and the dashboard feed shows who closed it. An
    alert that was resolved before an agent's next hook call is no longer "open", so
    neither /events delivery nor check_conflicts should surface it.
    """
    rows = conn.execute("SELECT payload FROM events WHERE type = 'alert_resolved'").fetchall()
    ids: set[int] = set()
    for row in rows:
        try:
            ids.add(int(json.loads(row["payload"]).get("alert_id")))
        except (TypeError, ValueError):
            continue
    return ids


def should_run_coordinator(file: str) -> bool:
    """Debounce: at most one coordinator call per file per DEBOUNCE_SECONDS.

    Runs before any model call, so routine edits never touch the team's shared
    60-requests-per-minute quota.
    """
    now = time.monotonic()
    last = _last_seen.get(file)
    _last_seen[file] = now
    # `last is None` rather than a 0.0 default: time.monotonic() counts from an arbitrary
    # origin, so on a freshly booted VM `now` can be smaller than DEBOUNCE_SECONDS and a
    # 0.0 default would swallow the very first edit to a file.
    return last is None or (now - last) > DEBOUNCE_SECONDS


def judge_edit(diff: str, spec_entry: sqlite3.Row, agent: str) -> None:
    """Hand one edit to the coordinator, which decides whether it breaks the contract.

    The adapter between /events and backend/coordinator.py. In-process rather than a
    sibling service, so there is exactly one SQLite writer and no cross-process lock
    contention. Runs on a worker thread after the /events response has gone out (see
    handle_events), never on the event loop: a model round trip is 15-30 s.

    SQLite stores `consumers` and `shape` as JSON text, while run_coordinator expects
    them parsed — it json.dumps() the shape and iterates consumers as a list. A raw
    sqlite3.Row cannot be passed straight through: `consumers` would arrive as a string
    and get iterated one character at a time.
    """
    try:
        # Imported lazily so the server still boots when the coordinator's dependencies
        # or model configuration are absent. The tools and /events do not need it.
        from backend.coordinator import run_coordinator

        run_coordinator(
            diff,
            {
                "contract": spec_entry["contract"],
                "owner": spec_entry["owner"],
                "consumers": json.loads(spec_entry["consumers"]),
                "shape": json.loads(spec_entry["shape"]),
            },
        )
    except Exception as exc:
        # /events is an agent's only channel for pending alerts, so a missing API key, a
        # rate limit or a model outage must not turn the hook into a 500. Reported to the
        # container log rather than the events table: "checked_clean" would be a lie, and
        # CONTRACT.md's frozen type enum has no value for "tried and could not judge".
        print(
            f"[coordinator] judge_edit failed on {spec_entry['owner']} "
            f"(edited by {agent}): {exc!r}",
            flush=True,
        )


def fetch_undelivered_alerts(agent: str) -> list[dict]:
    """Alerts naming this agent that it has not been handed yet, marked as handed over.

    Delivery is tracked per agent rather than as one global flag: `affected` is a list, and
    a single boolean would mean the first agent to call /events consumed the alert for
    everyone else named in it. This is the only channel back into a running agent, so a
    dropped alert is a silently broken demo.
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, payload, delivered_to FROM events WHERE type = 'alert' ORDER BY id"
    ).fetchall()
    resolved = resolved_alert_ids(conn)

    pending = []
    for row in rows:
        if row["id"] in resolved:
            continue
        payload = json.loads(row["payload"])
        delivered_to = json.loads(row["delivered_to"])
        if agent in payload.get("affected", []) and agent not in delivered_to:
            pending.append((row["id"], payload, delivered_to))

    for event_id, _, delivered_to in pending:
        conn.execute(
            "UPDATE events SET delivered_to = ? WHERE id = ?",
            (json.dumps(delivered_to + [agent]), event_id),
        )
    conn.commit()
    conn.close()

    return [
        {
            "summary": payload.get("summary", ""),
            "affected": payload.get("affected", []),
            "suggested_fix": payload.get("suggested_fix", ""),
        }
        for _, payload, _ in pending
    ]


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
        "SELECT id, payload FROM events WHERE type = 'alert' ORDER BY id DESC LIMIT 50"
    ).fetchall()
    resolved = resolved_alert_ids(conn)
    conn.close()
    log_event(agent, "check_conflicts", {"files": files})

    lines = [f"{row['agent']} is working on {row['file']}: {row['summary']}" for row in claim_rows]
    for row in alert_rows:
        if row["id"] in resolved:
            continue
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
    """Ask to change a contract's agreed shape. The spec does not change until a human accepts this.

    `entry` is the contract name exactly as get_spec reports it (e.g. "GET /users/{id}").
    `change` is the complete new shape as JSON text -- the dashboard diffs it against the
    current shape, and on acceptance it becomes the new agreed shape verbatim.
    """
    agent, _ = caller_identity()
    log_event(agent, "propose_spec_change", {"entry": entry, "change": change, "reason": reason})
    return f"Proposal for {entry} logged. Waiting on a human to accept it before the spec changes."


@mcp.custom_route("/events", methods=["POST"])
async def handle_events(request: Request) -> JSONResponse:
    """The PostToolUse hook endpoint: report an edit, get back any alerts waiting for you.

    A plain Starlette route rather than an MCP tool, so a hook script can reach it with
    curl whatever the agent decides to do. Headers come straight off the request —
    get_http_headers() is for tool calls and has no request context here.
    """
    try:
        agent, _ = resolve_identity(_bearer(request.headers.get("authorization", "")))
    except ValueError:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "body must be JSON"}, status_code=400)

    file = body.get("file")
    diff = body.get("diff", "")
    if not isinstance(file, str) or not file:
        return JSONResponse({"error": "field 'file' is required"}, status_code=400)

    # The hook also sends an "agent" field; it is ignored on purpose. The token decides who
    # you are, so an agent cannot report an edit as someone else.
    log_event(agent, "edit", {"file": file, "diff": diff})

    conn = get_db()
    owner_row = conn.execute("SELECT * FROM spec WHERE owner = ?", (file,)).fetchone()
    conn.close()

    # The deterministic filter: only a file that owns a contract is worth a model call.
    #
    # The judgement is scheduled as a BackgroundTask, which Starlette runs on a worker
    # thread AFTER the response has been sent. It used to be called inline, which lost
    # alerts in rehearsal for two compounding reasons:
    #   1. A model round trip takes 15-30 s, but hooks/report_edit.py gives up after 5 s.
    #      The response never reached the hook -- yet fetch_undelivered_alerts() below had
    #      already stamped the alerts it carried as delivered, so they were gone for good.
    #   2. judge_edit is synchronous, so calling it from this async handler froze the whole
    #      event loop: every other agent's hook and MCP call stalled for the duration and
    #      timed out the same way, whether or not it touched a contract.
    # The editing agent never needs the verdict in its own response: an alert names the
    # consumers' claimants, who receive it on their next call, once it exists.
    background = None
    if owner_row is not None and should_run_coordinator(file):
        background = BackgroundTask(judge_edit, diff, owner_row, agent)

    return JSONResponse({"alerts": fetch_undelivered_alerts(agent)}, background=background)


def _decider(request: Request) -> str:
    """Who made a dashboard decision.

    The dashboard has no login (SPEC.md puts auth out of scope), so these routes are open
    like /health and the decision is attributed to "human". A teammate's bearer token, if
    one is sent, attributes it to them instead.
    """
    try:
        name, _ = resolve_identity(_bearer(request.headers.get("authorization", "")))
        return name
    except ValueError:
        return "human"


def _event_row(conn, event_id: str, expected_type: str):
    try:
        event_id = int(event_id)
    except ValueError:
        return None
    row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    return row if row is not None and row["type"] == expected_type else None


@mcp.custom_route("/api/proposals/{proposal_id}", methods=["POST"])
async def handle_proposal_decision(request: Request) -> JSONResponse:
    """A human accepts or rejects a propose_spec_change from the dashboard.

    Body: {"status": "accepted" | "rejected"}. The proposal id is the id of its
    propose_spec_change event row, which is what the dashboard uses as the proposal id.

    Accepting is the one path that rewrites spec.shape (CONTRACT.md, Guarantees): the
    proposal's `change` text becomes the new shape. It has to be valid JSON, because
    judge_edit json.loads() the shape on every later edit -- a free-text shape would
    silently disable drift checks for that contract.
    """
    proposal_id = request.path_params["proposal_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "body must be JSON"}, status_code=400)
    status = body.get("status") if isinstance(body, dict) else None
    if status not in ("accepted", "rejected"):
        return JSONResponse({"error": "field 'status' must be 'accepted' or 'rejected'"}, status_code=400)

    decider = _decider(request)
    conn = get_db()
    try:
        row = _event_row(conn, proposal_id, "propose_spec_change")
        if row is None:
            return JSONResponse({"error": f"no proposal with id {proposal_id}"}, status_code=404)
        proposal = json.loads(row["payload"])

        for prior in conn.execute("SELECT payload FROM events WHERE type = 'proposal_decision'").fetchall():
            decided = json.loads(prior["payload"])
            if decided.get("proposal_id") == row["id"]:
                return JSONResponse(
                    {"error": f"proposal {row['id']} is already {decided.get('status')}", "status": decided.get("status")},
                    status_code=409,
                )

        payload = {"proposal_id": row["id"], "status": status, "entry": proposal.get("entry")}
        if status == "accepted":
            try:
                new_shape = json.loads(proposal.get("change", ""))
            except (TypeError, ValueError):
                return JSONResponse(
                    {"error": "the proposal's `change` is not JSON, so it cannot become the new shape; reject it and re-propose"},
                    status_code=422,
                )
            current = conn.execute("SELECT shape FROM spec WHERE contract = ?", (proposal.get("entry"),)).fetchone()
            if current is None:
                return JSONResponse({"error": f"no spec entry named {proposal.get('entry')!r}"}, status_code=404)
            shape_text = json.dumps(new_shape, indent=2)  # same formatting backend/seed.py writes
            conn.execute("UPDATE spec SET shape = ? WHERE contract = ?", (shape_text, proposal.get("entry")))
            # Kept so the dashboard can still diff an accepted proposal against what the
            # shape was, now that spec.shape itself equals the proposal.
            payload["previous_shape"] = current["shape"]
            payload["shape"] = shape_text
        conn.execute(
            "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
            (decider, "proposal_decision", json.dumps(payload)),
        )
        conn.commit()
    finally:
        conn.close()
    return JSONResponse({"id": row["id"], "status": status, "by": decider})


@mcp.custom_route("/api/alerts/{alert_id}/resolve", methods=["POST"])
async def handle_alert_resolve(request: Request) -> JSONResponse:
    """A human marks an alert resolved from the dashboard.

    Logs an alert_resolved event; the alert row itself is never edited. Idempotent: a
    second call for the same alert answers 200 without logging a duplicate.
    """
    alert_id = request.path_params["alert_id"]
    decider = _decider(request)
    conn = get_db()
    try:
        row = _event_row(conn, alert_id, "alert")
        if row is None:
            return JSONResponse({"error": f"no alert with id {alert_id}"}, status_code=404)
        if row["id"] in resolved_alert_ids(conn):
            return JSONResponse({"id": row["id"], "status": "resolved", "already": True})
        conn.execute(
            "INSERT INTO events (agent, type, payload) VALUES (?, ?, ?)",
            (decider, "alert_resolved", json.dumps({"alert_id": row["id"]})),
        )
        conn.commit()
    finally:
        conn.close()
    return JSONResponse({"id": row["id"], "status": "resolved", "by": decider})


@mcp.custom_route("/health", methods=["GET"])
async def handle_health(request: Request) -> JSONResponse:
    """Unauthenticated so the deploy script can poll it and it can be opened in front of judges."""
    db_ok = False
    journal_mode = None
    event_count = None
    try:
        conn = get_db()
        journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        event_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        conn.close()
        db_ok = True
    except sqlite3.Error:
        pass

    # backend/coordinator.py selects its provider from this and reads that provider's key.
    provider = os.environ.get("COORDINATOR_MODEL_PROVIDER", "akamai")
    key_var = {
        "akamai": "AKAMAI_TEAM_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
    }.get(provider)

    return JSONResponse(
        {
            "status": "ok" if db_ok else "degraded",
            "db": {
                "ok": db_ok,
                "path": DB_PATH,
                "journal_mode": journal_mode,
                "events": event_count,
            },
            "inference": {
                "provider": provider,
                # ollama takes no key, so no key_var means there is nothing to configure.
                "configured": key_var is None or bool(os.environ.get(key_var)),
            },
            "tokens_loaded": len(TEAM_TOKENS),
        },
        status_code=200 if db_ok else 503,
    )


if __name__ == "__main__":
    init_db()
    mcp.run(transport="http", host="0.0.0.0", port=8000)