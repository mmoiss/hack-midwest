# Coordinator ↔ Agent Integration: local end-to-end test

Oct 10, 2026. Run while Track A's real Linode/Akamai-hosted MCP server deployment is still
outstanding (no public hostname exists yet — see CONTRACT.md/SETUP.md). The goal: prove the
whole chain — **real Claude Code / real Codex hooks → real `/events` → real Strands
coordinator against the real Akamai model → alert delivered back to the right teammate** —
works end to end *right now*, locally, using the exact same code that will run once Track A's
deployment lands, so that repointing a URL is the only thing left to do.

Everything below was run against real CLIs (`claude`, `codex`) making real edits, a real local
server, and the real `hackathon-chat` model. Nothing here is simulated except where explicitly
noted (two direct `curl` calls used as precise, low-noise checks of server behavior).

## Setup

1. **Real coordinator wiring.** `main`'s `judge_edit` is still the original stub (always logs
   `checked_clean`, never calls the coordinator) — the real wiring exists only on Track A's
   unmerged branch `feat/wire-coordinator-to-events`. Created a local-only branch
   (`local-integration-test`, never pushed) merging `main` + that branch. Merged clean, zero
   conflicts.
2. **Real tokens.** `python scripts/make_tokens.py aruneem matthew` — generated real bearer tokens
   mapping to `aruneem` and `matthew`, matching the two teammates in `backend/seed.py`'s demo data.
3. **Seeded the DB.** `python backend/seed.py` — loads the real demo `spec`/`claims`/`events`
   rows matching `demo-repo-template`'s actual files exactly.
4. **Started the real server**, in-process coordinator and all:
   ```
   TEAM_TOKENS='{"tok_...":{"name":"aruneem",...},"tok_...":{"name":"matthew",...}}' \
   COORDINATOR_MODEL_PROVIDER=akamai AKAMAI_TEAM_KEY=... AKAMAI_BASE_URL=... AKAMAI_CHAT_MODEL=hackathon-chat \
   python -m backend.mcp
   ```
   `/health` confirmed: WAL mode on, `inference.configured: true`, `tokens_loaded: 2`.
5. **Set up the live demo repo** per `SETUP.md`: `cp -r demo-repo-template demo-repo`, `git init`,
   tagged `demo-seed`.
6. Confirmed `python3` resolves on this machine (`SETUP.md` flagged this as unverified on any
   real presenting machine — it's fine here, but **still unverified on the actual presenting
   laptops**).
7. Pointed the hooks at the real local server instead of the mock via env vars
   (`TEAM_EVENTS_URL=http://localhost:8000/events`, `CLAUDE_TEAM_TOKEN`/`CODEX_TEAM_TOKEN` set to
   the real tokens) — `.mcp.json` / `.codex/config.toml` already pointed at `localhost:8000/mcp`,
   so no file edits were needed, only env vars.

## Findings

### 1. `backend/seed.py`'s demo narrative confuses a real agent — run `reset.sh` before any live run

`seed.py` seeds rich, fictional events for a nice-looking populated dashboard, including an
alert naming aruneem as affected by a scripted "Sandi started editing users.py" event that never
really happened in this session. The first time aruneem (real Claude Code) called `check_conflicts`
for real, this **stale fictional alert surfaced as if it were live**, and the agent — correctly
following its own instructions — refused to proceed without asking a human first:

> *"Concurrent edit: Sandi is already editing `backend/api/users.py`... How do you want to
> proceed?"*

**Fix verified:** `demo-repo/scripts/reset.sh` wipes `claims`/`events` (keeps `spec`) and
correctly resolved its DB path against this exact local setup:
```
$ bash scripts/reset.sh
Using DB_PATH=.../demo-repo/../coordinator.db
Wiped claims/events in .../coordinator.db
```
After that, `claims=0`, `events=0`, `spec=2` — confirmed by direct query.

**Process recommendation:** `seed.py` is for a polished-looking dashboard before anyone's
watching; `reset.sh` must run immediately before any real agent interaction, rehearsal or live.
Don't let the two get out of order.

### 2. The full chain works, end to end, for real — confirmed by direct DB inspection

With a clean DB, ran a real headless Claude Code session as aruneem:
```
TEAM_EVENTS_URL=http://localhost:8000/events CLAUDE_TEAM_TOKEN=<aruneem's token> \
claude -p "In backend/api/users.py, remove the email field from the JSON response
returned by get_user. Just make that one change." --dangerously-skip-permissions
```
Result, read straight from the `events` table afterward:
```
(17, aruneem, edit,  {"file": "backend/api/users.py", "diff": "... -\"email\": user.email, ..."})
(18, coordinator, alert, {"summary": "The `email` field was removed...", "affected": [...], "suggested_fix": "Restore the \"email\": user.email..."}})
```
The real `PostToolUse` hook fired, posted the real diff to the real `/events`, the deterministic
filter correctly identified `backend/api/users.py` as an owner file, and the real Strands
coordinator (Akamai `hackathon-chat`, temperature=0) correctly judged it as a break and wrote a
correct, well-formed alert — no fixtures, no mocks, anywhere in this path.

Also confirmed: the hook's self-reported `"agent": "claude-code"` field was correctly ignored —
the event is attributed to `aruneem`, resolved purely from the bearer token, exactly as
CONTRACT.md specifies.

### 3. Claims must exist *before* the breaking edit, or the alert can't reach anyone by name — both failure and success modes verified

Right after `reset.sh` (claims wiped), the alert above came back with
`"affected": ["frontend/src/api/client.ts", "frontend/src/components/UserCard.tsx"]` — **file
paths, not teammate names**, because nobody had re-claimed those consumer files yet.

Proved this makes the alert undeliverable with a direct check, simulating matthew's hook:
```
$ curl -X POST localhost:8000/events -H "Authorization: Bearer <matthew's token>" \
    -d '{"agent":"codex","file":"frontend/src/components/UserCard.tsx","diff":""}'
{"alerts":[]}
```

Then had matthew (real headless Codex) actually declare intent on the consumer file:
```
TEAM_EVENTS_URL=http://localhost:8000/events CODEX_TEAM_TOKEN=<matthew's token> \
codex exec "Call declare_intent for frontend/src/components/UserCard.tsx with summary
'Render user name and email in card', then add a one-line comment..." \
  --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox
```
A subsequent judgment on the still-broken contract (debounce window had passed) correctly
resolved the claim:
```
(23, coordinator, alert, {"affected": ["frontend/src/api/client.ts", "matthew"], ...})
```
And direct inspection confirmed correct, exactly-once delivery:
```sql
delivered_to: ["matthew"]
```
A follow-up `curl` simulating matthew's hook again correctly returned `{"alerts":[]}` — already
delivered, not re-sent.

**This is load-bearing for the actual demo script, not just a suggestion:** both agents must
`declare_intent` on their assigned files *before* the scripted breaking edit happens, or the
alert will never resolve to the right teammate's name. SPEC.md's demo script already implies
this ("both agents mid-task") — this test confirms it's required, not optional polish.

### 4. Codex's MCP tool calls need a stronger approval bypass than expected (headless-testing-specific)

`-s workspace-write -c approval_policy=never` was **not enough** — `declare_intent` failed with:
```
MCP tool call requires approval, but approval policy is never
```
Needed the full `--dangerously-bypass-approvals-and-sandbox` (not just the sandbox-permission
flag) to get MCP tool calls through non-interactively. This appears to be specific to headless
`codex exec` automation.

**Open question for whoever rehearses with Codex live:** does the normal *interactive* `codex`
session also pause for a manual MCP-approval prompt the first time it calls a team-coordinator
tool? If so, that needs to be clicked through once during rehearsal — well before the live pitch,
not during it. Not verified here; headless testing can't answer this.

Also observed, throughout every Codex MCP interaction, a stream of non-fatal warnings:
```
ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when
Client(HttpRequest(HttpRequest("error decoding response body")))
```
Tool calls completed successfully despite these every time. Worth knowing about so it doesn't
look alarming on a live terminal — but also worth someone independently checking whether this
ever actually causes a dropped call under different timing/load, since it was never explained,
only observed to be non-fatal in every case tried here.

### 5. Testing with one shared `demo-repo/` between two agents causes cross-attribution — expected, not a real-demo bug

`report_edit.py` deliberately diffs against the fixed `demo-seed` git tag, not "since this
agent's last report" (so an agent's own mid-session commits don't hide earlier changes from it).
Side effect observed here: because both aruneem and matthew were pointed at the *same* `demo-repo/`
directory (for test convenience), each one's hook run also re-reported the *other* agent's
still-uncommitted changes, misattributed to whichever agent's hook fired:
```
(22, matthew, edit, {"file": "backend/api/users.py", ...})   <- this was actually aruneem's edit
(30, aruneem, edit, {"file": "...UserCard.tsx", ...})      <- this was actually matthew's edit
```
**This should not happen in the real demo** — `SETUP.md` already specifies one `demo-repo/` per
presenting laptop, and each laptop's tree would only ever contain its own agent's edits relative
to the tag. Flagging this so nobody mistakes it for a real bug if they test the same simplified
way, and as a concrete reason the two-laptop setup has to actually be followed, not shortcut.

### 6. The clean-edit path also holds up with a real agent-authored diff, not just hand-written fixtures

Had aruneem restore `email` and also swap `User.query.get` for `get_or_404` in the same turn
(a genuinely contract-compliant improvement):
```
(28, aruneem, edit, {"diff": "... -user = User.query.get(user_id) \n +user = User.query.get_or_404(user_id) ..."})
(29, coordinator, checked_clean, {"contract": "GET /users/{id}"})
```
No false alert. Confirms the `temperature=0` fix (PR #6) holds up against a real, model-authored
diff — not just the two hand-written fixtures it was originally validated against.

## What this means for "frictionless once the real server is live"

The mechanism itself needs nothing further — this test exercised the exact same code
(`backend/mcp.py`'s `/events` route, debounce, `backend/coordinator.py`) that will run on the
real deployment. Repointing is genuinely just config:

1. **Merge `feat/wire-coordinator-to-events` into `main`.** Until that happens, the live server
   (built from `main`) cannot do any of this — its `judge_edit` is still the no-op stub.
2. Repoint `TEAM_EVENTS_URL` and the `.mcp.json` / `.codex/config.toml` URLs from `localhost:8000`
   to the real hostname once Track A has one.
3. Generate real per-person tokens with `make_tokens.py` the same way this test did, and set
   `TEAM_TOKENS` on the real deployment.
4. **Rehearsal order, now confirmed necessary, not just tidy:** `seed.py` (optional, once, for a
   populated-looking dashboard) → `reset.sh` (mandatory, immediately before any real run) → both
   agents `declare_intent` on their assigned files → only then the scripted breaking edit.
5. Not tested here, and can't be until Track A has a real box: Caddy/TLS routing and the public
   hostname itself. Recommend `curl <public-url>/health` as the very first smoke test once it
   exists, before trusting hooks against it.
6. Worth confirming before the live pitch: whether interactive `codex` (not just headless `exec`)
   also needs a one-time manual MCP approval click.

## Artifacts from this run

- `demo-repo/` — the live working copy used for this test, left in place (gitignored, untracked)
  for inspection. Run `demo-repo/scripts/reset.sh` to return it to `demo-seed` before reusing it.
- `coordinator.db` — the local database from this run (gitignored). Contains the real event
  history quoted above.
- Local branch `local-integration-test` — `main` + `feat/wire-coordinator-to-events` merged,
  never pushed. Safe to delete; it exists only to make this test possible before that branch
  merges for real.
