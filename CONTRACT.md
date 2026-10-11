# Contract: MCP Server, Hooks, and Akamai Deployment

Oct 10, 2026 · @Aruneem

This freezes the interface SPEC.md left as "draft, freeze before splitting up." Everyone builds against this document, not against whoever's code happens to compile first. If something here needs to change, change this file in the same breath as the code.

## Identity

Every call — MCP tool or hook POST — carries `Authorization: Bearer <token>`. The server holds one static table, built once at setup: `token → {name, color}`. No token or an unknown token is a `401`. There is no session, no OAuth, no refresh.

## MCP tools

Four tools, all read/write the same `spec`, `claims`, and `events` tables below. No tool calls a model. No tool is idempotent in the sense of "safe to call twice with no record" — every call is logged as an event, by design, so the dashboard's tool-call trace means something.

| Tool | Input | Output | Side effect |
|---|---|---|---|
| `declare_intent(files: list[str], summary: str) -> str` | files about to be touched, one-line summary | ack string | upserts one `claims` row per file for the caller, logs an event |
| `check_conflicts(files: list[str]) -> str` | files about to be touched | other agents' claims on those files, plus any open alert naming the caller | read-only, logs an event |
| `get_spec(path: str) -> str` | a file path | the spec entry that file owns or consumes, if any | read-only, logs an event |
| `propose_spec_change(entry: str, change: str, reason: str) -> str` | the contract name, the proposed change, why | ack string | logs an event; never writes `shape` — a human has to accept it first |

Caller identity (`name`, `color`) is resolved server-side from the bearer token on every call. No tool takes an `agent_name` argument — an agent can't claim to be someone else.

## Hook endpoint

Not an MCP tool — a FastMCP custom route, so a `PostToolUse` hook script can hit it with `curl` regardless of what the agent decides to do, with no separate web framework layered on top.

```
POST /events
Authorization: Bearer <token>
{ "agent": "codex", "file": "api/users.py", "diff": "<unified diff>" }

→ 200 { "alerts": [ { "summary": str, "affected": [str], "suggested_fix": str } ] }
```

Every alert returned is marked delivered **to that agent**. This is the only channel that gets information back into a running agent — there is no server-to-agent push.

The response is sent **before** the coordinator judges the edit. A contract-owning edit schedules the judgement on a worker thread once the response has gone out, so `/events` answers in milliseconds whether or not a model call follows. This matters because the hook script waits at most 5 seconds: judging inline (15–30 s) meant the hook timed out, the response carrying any pending alerts was never read, and those alerts had already been marked delivered — lost. It also kept the event loop free, so other agents' hooks and MCP calls are not stalled while one edit is being judged. The editing agent does not need the verdict in its own response; the alert names the consumers' claimants, who get it on their next call.

The `agent` field in the body is accepted and ignored. Identity comes from the bearer token, exactly as it does for the tools, so a hook cannot report an edit as somebody else. Hook scripts may keep sending it; nothing reads it.

Malformed input is rejected before anything is logged: unknown or missing token → `401`, a body that is not JSON or has no `file` → `400`.

## Shared state (SQLite, one file)

```sql
CREATE TABLE spec (
    contract  TEXT PRIMARY KEY,   -- e.g. "GET /api/users"
    owner     TEXT NOT NULL,      -- file that implements it
    consumers TEXT NOT NULL,      -- JSON list of files that depend on it
    shape     TEXT NOT NULL       -- JSON: the agreed response shape
);

CREATE TABLE claims (
    agent      TEXT NOT NULL,
    file       TEXT NOT NULL,
    summary    TEXT,
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (agent, file)
);

CREATE TABLE events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL DEFAULT (datetime('now')),
    agent   TEXT NOT NULL,
    type    TEXT NOT NULL,        -- "edit" | "declare_intent" | "check_conflicts" | "get_spec" |
                                   -- "propose_spec_change" | "alert" | "checked_clean" |
                                   -- "proposal_decision" | "alert_resolved" |  (dashboard, see below)
                                   -- "review_started" | "tool_call_started" | "tool_call_finished"
                                   --    (coordinator trace, see "Coordinator boundary")
    payload TEXT NOT NULL,        -- JSON, shape depends on type
    delivered_to TEXT NOT NULL DEFAULT '[]'  -- JSON list of agent names already handed this row
);
```

`delivered_to` only means anything on `type = "alert"` rows, and it is tracked **per agent, not as one boolean**. `affected` is a list, so a single `delivered` flag would let the first agent to call `/events` consume an alert on behalf of everyone else named in it — and `/events` is the only channel back into a running agent, so that alert would simply be lost. Dashboard queries can ignore this column; `init_db()` adds it to databases that predate it.

`spec` is hand-written once at setup for the demo repo. `claims` and `events` fill up live. The coordinator's `raise_alert` and `escalate_to_human` write `events` rows with `type = "alert"`; everything else — MCP tools and the hook — writes the row types listed above. Nothing lives outside these three tables; there is no second store to fall out of sync.

## Dashboard decisions

The two buttons on the dashboard that need a writer — **Accept/Reject** on a proposal and **Mark resolved** on an alert — go to the Python service, not the dashboard's Node server (which stays read-only). Two plain routes next to `/events`:

```
POST /api/proposals/{id}          { "status": "accepted" | "rejected" }
POST /api/alerts/{id}/resolve
```

`{id}` is the `events.id` of the `propose_spec_change` / `alert` row, which is what the dashboard already uses as the proposal or alert id. Each call logs one event:

| Row | Payload | Effect |
|---|---|---|
| `proposal_decision` | `{proposal_id, status, entry, previous_shape?, shape?}` | on `accepted`, **rewrites `spec.shape` for `entry` to the proposal's `change`** — the one path allowed to, per the guarantees below. `change` must be JSON (it becomes the shape `judge_edit` parses); free text is refused with `422`. A proposal is decided once: a second call is `409`. |
| `alert_resolved` | `{alert_id}` | the alert is no longer open: `/events` stops delivering it and `check_conflicts` stops reporting it. Idempotent. |

Identity: the dashboard has no login (SPEC.md puts auth out of scope), so these routes are open like `/health`, and the row's `agent` is `"human"`. If a teammate's bearer token is sent, the row is attributed to them instead. The dashboard's SSE server hides `"human"` from the crew list.

Unknown id, or an id of the wrong row type, is `404`; a body without a valid `status` is `400`. Caddy routes `/api/*` to the Python service (and `/api/stream` to the dashboard); the Vite dev server proxies the same two prefixes to `localhost:8000`.

Two more routes serve the demo launcher (`demo.sh` / `demo.ps1` in the demo repo), both **requiring a teammate's bearer token**:

```
GET  /api/whoami   -> 200 { "name": str, "color": str }      who this token is
POST /api/reset    -> 200 { "reset": true, "by": str, ... }  back to the demo's starting state
```

`/api/reset` rewrites `spec` to the seed's two contracts (undoing any accepted proposal), deletes every `claims` and `events` row, re-inserts the two demo claims (`backend/seed.py` `DEMO_CLAIMS`: aruneem on the users owner file, matthew on `UserCard.tsx`), and clears the coordinator's debounce memory. It is the only route that deletes anything, which is why it is not open like the decision routes: the dashboard URL is public.

## Guarantees

- The server never pushes to an agent mid-session. An agent only learns things on its *next* `/events` call.
- Only the coordinator's tools write `type = "alert"` rows. MCP tools and the hook log facts; they never judge a contract break themselves.
- `spec.shape` changes only when a human accepts a `propose_spec_change` (`POST /api/proposals/{id}` above). Catching drift never rewrites it.
- The Python service is the only writer of the SQLite file. It runs in WAL mode so the dashboard's TypeScript server can poll `events` for new rows and push them to the browser over Server-Sent Events, without a WebSocket or a second API layer.

## Running on Akamai

| Piece | Choice | Why |
|---|---|---|
| Compute | One Linode VM, Shared CPU (`g6-standard-1`), Ubuntu | Matches the Akamai workshop starter's own default; one service doesn't need a cluster. |
| Bootstrap | `cloud-init`: installs `docker.io` + `docker-compose-v2`, nothing else | Copied from the workshop's `deploy/cloud-init.yaml` — no secrets in cloud-init, ever. |
| Process layout | `docker compose`: `app` (bare FastMCP server, its own HTTP transport, SQLite) + `dashboard` (the React app's TypeScript server) + `caddy` (TLS) | No FastAPI, no WebSocket worker constraint — FastMCP serves its own tool endpoints and the `/events` custom route directly. **`dashboard` is not in `compose.yaml` yet** — Track D adds its service and uncomments the routing block in the `Caddyfile` when it hands off. |
| Networking | Cloud Firewall open on `80`, `443`, `22` only; Caddy routes MCP/hook paths to `app` and everything else to `dashboard` | The workshop's own demo opens its app port unauthenticated to the internet; ours carries bearer tokens, so it sits behind Caddy, not raw. |
| Inference | `OPENAI_BASE_URL=https://ws.akamai-workshops.com/v1`, model alias `hackathon-chat`, team key as bearer token, kept in `.env` on the VM only | Only the coordinator calls this. The four MCP tools above are plain Python — no model involved. |
| Rate limits | 60 requests/min and 100,000 chat tokens/min, shared across the whole team | The deterministic filter (does this file own a contract?) and debounce run *before* any model call, so routine edits never touch the quota. |
| State | SQLite file on a bind-mounted volume, WAL mode on | No managed Postgres, no Object Storage, no Valkey — all three exist in the workshop stack for document RAG, which this project doesn't do. WAL mode is what lets the dashboard's Node server read while Python writes. |
| Deploy mechanics | Manual, over SSH: create the VM + firewall in Cloud Manager, clone the repo via a read-only deploy key, write `.env` on the VM, `docker compose up -d --build`, seed, check `/health`. `SETUP.md` §4 covers a from-scratch VM; `INTEGRATION.md` §6 covers redeploying the existing one | There is no deploy script — the server was stood up by hand, and those two sections are the source of truth. |
| Health check | `GET /health` reporting inference connectivity + DB status | Same pattern as the workshop's `agent/server.py` — built to be opened live in front of judges. |

## Coordinator boundary

The coordinator runs **in-process**, imported by the server, not as a sibling service. One SQLite writer, no cross-process lock contention, and strictly less to build. `/events` calls it only after the deterministic filter (does this file own a contract?) and a 5-second per-file debounce both pass, so routine edits never reach the team's shared quota — and only after its response has been sent, on a worker thread, so the hook's 5-second timeout and the event loop are never held up by a model call.

Two functions, one on each side of the seam:

```python
# backend/mcp.py — the adapter /events calls
def judge_edit(diff: str, spec_entry: sqlite3.Row, agent: str) -> None

# backend/coordinator.py — the Strands agent
def run_coordinator(diff: str, spec_entry: dict, *, structured: bool = False, pending_proposal: dict | None = None) -> None
```

`spec_entry` is the one `spec` row the edited file owns — `contract`, `owner`, `consumers`, `shape` — already fetched, so the coordinator never queries for context. `consumers` holds file paths, which `run_coordinator` resolves against `claims` into teammate names itself; the caller does not do that lookup.

`pending_proposal` is the newest `propose_spec_change` for that contract with no `proposal_decision` yet (`{id, agent, change, reason}`), looked up by `judge_edit` (`pending_proposal_for`). It is the one piece of context that lets the coordinator tell a deliberate change from drift: an edit that moves the response toward a proposed shape awaiting approval is escalated with `escalate_to_human` (a "Human decision" card on the dashboard, answered by Accept/Reject on the Changes page) instead of alerting the consumers' owners.

**`judge_edit` exists to convert, not to delegate.** SQLite stores `consumers` and `shape` as JSON *text*, and `run_coordinator` needs them parsed — it `json.dumps()` the shape and iterates consumers as a list. Passing a raw `sqlite3.Row` through would hand it a string where a list belongs.

Neither function returns a verdict; both report by writing `events` rows (`type = "alert"` via `raise_alert`/`escalate_to_human`, else `type = "checked_clean"`, which also records the model, provider and `duration_ms`). `judge_edit` swallows every exception from the coordinator and logs it to the container log: `/events` is an agent's only channel for pending alerts, so a missing key, a rate limit or a model outage must not turn the hook into a `500`.

The coordinator also narrates itself with **trace events**, written as it works and rendered on the dashboard's Feed: `review_started` when a judgement begins (`{contract, owner, model, provider}` — the live proof of which model is judging), and `tool_call_started` / `tool_call_finished` around each Strands tool call (`{tool, input | status, model, provider, elapsed_ms}`). Trace rows are narration, not state: nothing reads them back, a failure to write one never aborts the review, and only the verdict rows above carry meaning for delivery or `check_conflicts`.

## Running the server

From the **repo root**, as a module:

```
python -m backend.mcp
```

Not `python backend/mcp.py`. The script form puts `backend/` at the front of `sys.path`, where `backend/mcp.py` shadows the installed `mcp` package that `fastmcp` imports internally, and startup dies with `No module named 'mcp.server'; 'mcp' is not a package`. The `Dockerfile` `CMD` uses the `-m` form for the same reason.

## Build order

1. Rename the existing `backend/mcp.py` stub's tools to the four above — landed alongside this contract in the same PR.
2. Prove a FastMCP custom route can serve `/events` alongside the tool endpoints in one bare FastMCP process — no FastAPI, per the latest SPEC.md.
3. Add the `/events` custom route, sharing the same SQLite connection as the tools.
4. Add the bearer-token header-reading helper once, apply it to both the MCP tools and `/events`.
5. Turn SQLite's WAL mode on and confirm the dashboard's TypeScript server can poll `events` concurrently while Python writes.
6. Decide where the coordinator lives: same process (direct SQLite) or sibling service over HTTP — avoid two processes opening the same SQLite file.
7. Build the deterministic filter + debounce as the first thing `/events` calls after logging the edit.
8. Smoke-test the Akamai inference connection in isolation before the coordinator depends on it.
9. Containerize: `Dockerfile`, `compose.yaml` with `app` + `dashboard` + `caddy`, cloud-init unchanged.
10. Settle the hostname now — DNS propagation is the one step with latency nobody controls. *Settled: `DOMAIN` is an sslip.io name, which needs no DNS record (`SETUP.md` §4.4).*
