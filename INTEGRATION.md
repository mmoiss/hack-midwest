# Integration notes — the server track, and how the other tracks plug into it

Written by the Server track (Track A) after deploying to Akamai and wiring the coordinator
in. This is the context you need to join your work to the live server without rediscovering
things the hard way. `CONTRACT.md` is still the authority on interfaces; this file is the
*operational* layer — what is actually running, what was verified, and the traps that cost
time.

**No secrets in this file.** Bearer tokens and the Akamai key live only in `.env` on the VM.

---

## 1. What is live right now

```
https://172-237-146-90.sslip.io
```

| Path | Method | Purpose |
|---|---|---|
| `/mcp` | POST | MCP streamable-HTTP transport — the four tools |
| `/events` | POST | the `PostToolUse` hook endpoint |
| `/health` | GET | status, unauthenticated, safe to open in front of judges |

**`/mcp` takes no trailing slash.** `/mcp/` answers `307` and some clients will not follow
the redirect. The server's own startup banner prints the canonical path if you ever need to
re-confirm it.

Running on one Linode (`g6-standard-1`, Ubuntu 24.04, Chicago `us-ord`), two containers:
`app` (FastMCP + SQLite) and `caddy` (TLS). The app publishes **no ports** — Caddy reaches it
over Docker's internal network, so port 8000 is not exposed to the internet at all.

### The hostname has no DNS record

`172-237-146-90.sslip.io` resolves because **sslip.io reads the IP out of the name** and
returns it. Nothing was registered and nothing propagates. It is a real public name, so
Let's Encrypt issues a genuinely trusted certificate for it — verified, issuer
`Let's Encrypt CN=YE2`.

If the VM is ever rebuilt with a different IP, the hostname changes with it: put the new
`<ip-with-dashes>.sslip.io` in `.env` as `DOMAIN` and restart. No config file changes —
the `Caddyfile` reads `{$DOMAIN}`.

---

## 2. Joining your track to it

### Track B — hooks

Point `TEAM_EVENTS_URL` at `https://172-237-146-90.sslip.io/events` and give each agent its
own bearer token (`CLAUDE_TEAM_TOKEN` / `CODEX_TEAM_TOKEN`). The request shape is unchanged
from the mock:

```
POST /events
Authorization: Bearer <token>
{ "agent": "codex", "file": "backend/api/users.py", "diff": "<unified diff>" }

→ 200 { "alerts": [ { "summary": str, "affected": [str], "suggested_fix": str } ] }
```

Two things the mock could not tell you:

- **The `agent` field in the body is ignored.** Identity comes from the token, server-side.
  Keep sending it if convenient; nothing reads it. An agent cannot report an edit as someone
  else.
- **Errors are real now.** Unknown or missing token → `401`. Body that is not JSON, or has no
  `file` → `400`. The mock always returned 200.

### Track C — the coordinator

`backend/coordinator.py` runs **in-process**, imported by `backend/mcp.py`. One SQLite
writer, no cross-process lock contention. The seam is `judge_edit` in `mcp.py`:

```python
judge_edit(diff, spec_entry: sqlite3.Row, agent)   # mcp.py — adapter
    └── run_coordinator(diff, spec_entry: dict)    # coordinator.py — the Strands agent
```

`judge_edit` exists to **convert, not delegate**. SQLite stores `consumers` and `shape` as
JSON *text*; `run_coordinator` needs them parsed — it `json.dumps()` the shape and iterates
consumers as a list. Passing a raw `sqlite3.Row` straight through would hand it a string
where a list belongs, and the `IN (...)` query would get one placeholder per character.

`judge_edit` swallows every exception from the coordinator and logs it to the container log.
`/events` is an agent's only channel for pending alerts, so a missing key, a rate limit or a
model outage must not turn the hook into a `500`. If the coordinator is misbehaving you will
see it in `docker compose logs app`, not in a failed hook:

```
[coordinator] judge_edit failed on <file> (edited by <agent>): <exception>
```

### Track D — the dashboard

Read the SQLite file directly, as planned. WAL mode is on and verified
(`/health` reports `journal_mode: wal`), so you can poll `events` while Python writes.

**The `events` table has a column that is not in CONTRACT.md's original schema:**

```sql
delivered_to TEXT NOT NULL DEFAULT '[]'   -- JSON list of agent names already handed this row
```

It only means anything on `type = "alert"` rows. Ignore it for display purposes — but do not
be surprised by it in a `SELECT *`, and do not write to it.

Why per-agent and not a boolean: `affected` is a list. A single `delivered` flag would let
the first agent to call `/events` consume an alert on behalf of everyone else named in it,
and `/events` is the only channel back into a running agent, so that alert would simply be
lost. Verified: an alert affecting alice and bob is delivered to each exactly once,
independently.

The dashboard service is **not in `compose.yaml` yet** — that is Track D's to add. The
`Caddyfile` has the routing block for it commented out at the bottom: MCP/hook/health paths
stay on `app`, everything else goes to `dashboard`.

---

## 3. Decisions worth knowing

**The coordinator runs in-process, not as a sibling service.** One SQLite writer, no lock
contention, strictly less to build. Recorded in `CONTRACT.md` under "Coordinator boundary".

**`affected` holds teammate names, not file paths.** `_resolve_affected_agents()` maps
consumer files to whoever claimed them in the `claims` table, in plain Python, before the
model runs. This is SPEC.md's "who is affected is a lookup, not a reasoning step."

> **Live behaviour worth knowing for the demo:** if a consumer file has **no claim**, the
> resolver falls back to the raw file path. A real run produced
> `affected: ["frontend/src/api/client.ts", "bob"]` — bob was notified because he had claimed
> `UserCard.tsx`; `client.ts` had no claimant so its path came through instead, and no agent
> matches a path. Have the demo agents call `declare_intent` first and this does not bite.

**The server is started as a module, never as a script.**

```
python -m backend.mcp      # correct
python backend/mcp.py      # breaks
```

The script form puts `backend/` at the front of `sys.path`, where `backend/mcp.py` shadows
the installed `mcp` package that `fastmcp` imports internally. Startup then dies with
`No module named 'mcp.server'; 'mcp' is not a package` — and `fastmcp` catches that and
reports a misleading *"FastMCP server support is not installed"*, which sends you off
reinstalling a package that was never missing. The `Dockerfile` `CMD` uses `-m`.

**Debounce runs before any model call.** 5 seconds per file, in-memory. A burst of saves
costs one coordinator call, so routine edits never touch the team's shared 60-req/min quota.

---

## 4. Traps that already cost time

**`down -v` destroys your TLS certificate.** The `caddy_data` volume holds it. Let's Encrypt
allows roughly five identical certificates per week — burn those and the hostname cannot get
a new one until the window resets. Always `docker compose down`, never `down -v`.

**`#` in `.env` truncates values.** The teammate colors are hex. Unquoted, an env parser
reads `#` as a start-of-comment and silently cuts the JSON short. The server then starts
cleanly and rejects every token, which looks exactly like an auth bug. `make_tokens.py`
emits the line single-quoted; keep it that way.

**Two different env vars point at the same database.** `backend/mcp.py` reads `DB_PATH`;
`backend/coordinator.py` reads `COORDINATOR_DB_PATH`. `compose.yaml` sets both to
`/app/data/coordinator.db`. Leave either unset and the coordinator writes alerts to a file
nothing reads.

**`seed.py` honours `DB_PATH` now.** It used to hardcode a relative `coordinator.db`, so
seeding from `/app` wrote `/app/coordinator.db` while the server read the volume. The seed
reported success, the `spec` table stayed empty, and no edit ever reached the coordinator —
a silent failure that looks like a broken coordinator. Fixed; `/health` reporting
`"events": 0` after a seed is the tell if it ever regresses.

**Antivirus HTTPS scanning on a laptop breaks MCP to the VM, and looks like a server fault.**
Symptom: Claude Code reports `MCP server team-coordinator connection timed out after 30000ms
(CONNECT_TIMEOUT)` against the VM, while `/health`, `/events`, the dashboard and curl all work,
and the app log shows initialize/tools/list answered 200. Codex on the same laptop still works
but logs `rmcp ... error decoding response body` repeatedly. Cause, found 2026-10-11: Norton
"Web/Mail Shield" (and any product that intercepts TLS) re-encrypts the connection and rewrites
the MCP server's empty `202 Accepted` for notifications into a chunked response whose end never
arrives; Claude Code's client waits for it. Check from the affected laptop:

```bash
openssl s_client -connect 172-237-146-90.sslip.io:443 -servername 172-237-146-90.sslip.io </dev/null 2>/dev/null | openssl x509 -noout -issuer
# healthy: issuer=C = US, O = Let's Encrypt, ...     intercepted: issuer=... Norton Web/Mail Shield ...
```

Fix on that laptop: exclude the host from the antivirus's HTTPS/SSL scanning (Norton: Settings →
Firewall → Intrusion and Browser Protection → SSL/TLS scanning exclusions, or turn off Web Shield's
HTTPS scanning for the demo). Workaround with no settings change: an SSH tunnel to the app
container, plain HTTP, then point `.env` at it — proven to connect Claude Code first try:

```bash
ssh -N -L 18000:$(ssh root@172.237.146.90 "docker inspect coordinator-app-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'"):8000 root@172.237.146.90 &
# .env: TEAM_MCP_URL=http://127.0.0.1:18000/mcp   TEAM_EVENTS_URL=http://127.0.0.1:18000/events
```

Nothing on the server fixes this: Caddy 2.10 and 2.11, with and without `flush_interval`, behave
identically, and the same request from the VM itself completes in 40 ms.

**A changed Caddyfile is invisible to the running Caddy, and `caddy reload` says "config is
unchanged".** `compose.yaml` bind-mounts `./Caddyfile` as a single file. `git pull` writes the
new version as a new inode, and the container keeps the old one, so `caddy reload` re-reads the
stale file and reports no change while the routes you just merged return 405 from the static
file server. Cost a redeploy on 2026-10-11 (the `/api/*` block from #25). `docker compose up -d
--force-recreate caddy` remounts the file; the certificate is in the `caddy_data` volume and is
not reissued.

**An empty `spec` table means drift can never fire.** `/events` only calls the coordinator
for files that *own* a contract. Run the seed after any fresh deploy.

**Anything `coordinator.py` imports directly must be in `requirements.txt`.** It is not
enough that the package resolves transitively today. `judge_edit` wraps the whole coordinator
call — including `from backend.coordinator import run_coordinator` — in a blanket
`except Exception`, deliberately, so a model outage cannot turn a hook into a `500`. The side
effect is that an `ImportError` is swallowed too, and a missing dependency looks exactly like
a clean "no drift found" verdict: every edit passes silently, with nothing but one line in the
container log to say otherwise. `python-dotenv` and `pydantic` are declared explicitly for
this reason; add any future direct import the same way.

---

## 5. Verified, and not

**Verified in production, over the public internet:**

- Real Let's Encrypt certificate, clean TLS verification, `http` → `308` → `https`
- `/health` 200 with `journal_mode: wal`, `inference.configured: true`, all tokens loaded
- `/events`: `401` unauthenticated, `400` malformed, `200` with alerts
- A real drift catch: an agent removed `email` from the contract-owning file, the Akamai
  `hackathon-chat` model judged it against the stored shape, raised an alert naming the
  affected teammate with a correct concrete fix, and that alert reached the other agent on
  its next hook call — then did not repeat
- MCP transport connected from a second machine, four tools listed, `declare_intent`
  executed and attributed to the token holder
- Database survives container destroy/recreate on the mounted volume

**Tool calling works on `hackathon-chat`** — SPEC.md flagged it as unproven. Isolated smoke
test: plain completion 2.9s, tool call 3.4s, 368 tokens. The structured-output fallback in
`coordinator.py` is insurance, not a necessity.

**Not verified / known gaps:**

- The Cloud Firewall's inbound policy is still ACCEPT. Nothing listens on ports other than
  80/443, so there is no exposed service behind it — this is missing defence-in-depth, not an
  open door. Set the default inbound policy to DROP with ACCEPT rules for 22/80/443 to close
  it.
- ~~The dashboard service and its Caddy route are not deployed.~~ Deployed with #23; redeploy steps in §6 cover its build.
- The Cloud Firewall gap above is the only outstanding dependency-or-config risk; the
  undeclared-import problem that used to sit here is fixed — see the trap below.

---

## 6. Redeploying

**Merging on GitHub does not redeploy anything.** The VM keeps running whatever was last
`git pull`'d and `docker compose up --build`'d on it, regardless of what `main` looks like
on GitHub. **After merging any PR that touches `backend/` or `deploy/`, the steps below are
mandatory, not optional** — §5's "Verified in production" claims are only true for whatever
commit was actually deployed *when that section was written*, not for `main` as it stands
now. It's entirely possible to merge a fix, believe it's live, and be wrong because nobody
actually logged in and updated the box.

**Pre-flight — confirm what's actually running before trusting anything in §5:**

```bash
ssh root@172.237.146.90
cd /opt/coordinator
git log -1          # or: git status
```

Compare that commit against `main`'s current `HEAD` on GitHub. If they don't match, treat
§5's verification results as describing that old commit, not `main`.

**Redeploy:**

```bash
git pull origin <branch>
# Dashboard: Caddy serves frontend/dist off disk, and git never touches dist. The host has
# no Node, so build with the node image compose already pulled (writes frontend/node_modules too).
docker run --rm -v /opt/coordinator/frontend:/app -w /app node:24 sh -c "npm ci && npm run build"
docker compose up -d --build        # never `down -v`
docker compose restart dashboard    # server.ts is bind-mounted; `up` does not restart an unchanged service
# If the Caddyfile changed: recreate, do not `caddy reload` (see the trap below). Certs live in
# the caddy_data volume and survive this.
docker compose up -d --force-recreate caddy
curl -s https://172-237-146-90.sslip.io/health
```

`.env` is gitignored and lives only on the VM, so a pull never disturbs it. To reset the
demo to its starting state, nobody needs the VM any more: `./demo.sh reset` (or
`.\demo.ps1 reset`) in any teammate's demo clone calls `POST /api/reset` with their token,
which restores the contracts, clears events and re-seeds the two demo claims. The
equivalent from the box, if you are already on it:

```bash
curl -s -X POST https://172-237-146-90.sslip.io/api/reset -H "Authorization: Bearer <any teammate token>"
```

`docker compose exec app python backend/seed.py` still works but seeds the contracts only, with no claims.

**Last confirmed run of this checklist: 2026-10-10, closing out #15.** The box was found
sitting on `feat/wire-coordinator-to-events`@`bc99688` — 9 commits behind `main`, missing
`f8a7621` (the `seed.py` `DB_PATH` fix). That's not a hypothetical: it meant a seed run on
the box as it stood would have silently written to the wrong file, leaving `spec` empty, and
per `CONTRACT.md` an empty `spec` table means drift can never fire. Brought current:

```
git checkout main && git pull origin main   # -> 8670226
docker compose up -d --build
docker compose exec app python backend/seed.py
curl -s https://172-237-146-90.sslip.io/health   # "events": 12 matched seed.py's row count at the time; it now seeds contracts only, so expect 0
```

Then re-ran the actual drift smoke test against the now-current server — a real `/events`
POST (not a fixture) removing `email` from `backend/api/users.py`, judged by the real
Akamai `hackathon-chat` model:

```
(13, alice, edit,      {"file": "backend/api/users.py", "diff": "... -\"email\": user.email, ..."})
(14, coordinator, alert, {"summary": "The GET /users/{id} response no longer includes the required \"email\" field...",
                          "affected": ["frontend/src/api/client.ts", "bob"], "suggested_fix": "Restore the \"email\": user.email entry..."})
```

Correct on every count: `client.ts` has no claim so it fell back to its path, `bob` resolved
from his claim on `UserCard.tsx`, and the model correctly caught the break. `main`@`8670226`
is confirmed working end to end on the live server, not just on a branch or a local fixture.
