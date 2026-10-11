# Demo runbook — two laptops, the Akamai-hosted server

The short version of SPEC.md's demo section, as rehearsed on 2026-10-11. SETUP.md covers
standing the server up; INTEGRATION.md covers redeploying it. This file is only what you do
on the day.

## Server (already live)

| | |
|---|---|
| Dashboard | https://172-237-146-90.sslip.io |
| Health | https://172-237-146-90.sslip.io/health — expect `"events": 0` at the start |
| MCP | https://172-237-146-90.sslip.io/mcp |
| Hook | https://172-237-146-90.sslip.io/events |

Tokens live only in `.env` on the VM, one per teammate, keyed by name. Ask whoever owns the
server for yours. Never put one in a tracked file.

## Each laptop, once

1. Copy `demo-repo-template` to a folder of your own and tag it. The hook diffs against this
   tag on every edit, so a stale or missing tag turns the feed into noise.
   ```bash
   cp -r demo-repo-template demo-repo && cd demo-repo
   git init -q && git add -A && git commit -q -m demo-seed && git tag demo-seed
   ```
2. Check `python3 --version` works in the shell you will use. Both hook configs call
   `python3`; if it fails (stock Windows), change it to `python` in `.claude/settings.json`
   and `.codex/hooks.json`.
3. Codex only: in `.codex/config.toml` set `url = "https://172-237-146-90.sslip.io/mcp"`.
   That file does no env-var substitution.

## Each laptop, every session

Export before launching the agent, in the shell you launch it from. Neither CLI reads
`.env` files.

```bash
# Laptop A, Claude Code as alice
export CLAUDE_TEAM_TOKEN=<alice's token>
export TEAM_MCP_URL=https://172-237-146-90.sslip.io/mcp
export TEAM_EVENTS_URL=https://172-237-146-90.sslip.io/events
claude

# Laptop B, Codex as bob
export CODEX_TEAM_TOKEN=<bob's token>
export TEAM_EVENTS_URL=https://172-237-146-90.sslip.io/events
codex
```

Smoke test before any prompt, from each laptop:
`curl https://172-237-146-90.sslip.io/health`

## The prompts

**Laptop A, alice — the breaking edit:**

> You are the teammate 'alice'. Per CLAUDE.md, call declare_intent for backend/api/users.py
> with a one-line summary, then check_conflicts for it. Then make one minimal edit: remove
> the 'email' entry from the JSON response in get_user in backend/api/users.py. Touch no
> other file. Finish with one sentence: what you changed and anything the coordinator told
> you.

Wait until the alert appears on the dashboard (8 to 18 seconds). Then:

**Laptop B, bob — the adaptation:**

> You are the teammate 'bob'. Per AGENTS.md, first call check_conflicts for
> frontend/src/components/UserCard.tsx and read the result. If it reports an open alert for
> you, make one minimal edit to UserCard.tsx so the component no longer depends on the field
> the API dropped. Do not edit any backend file. Quote any [team-coordinator] message that
> appears, then one sentence on what you changed.

If the roles are swapped: Claude Code reads `CLAUDE.md`, Codex reads `AGENTS.md`, and Codex
registers the server as `team_coordinator` (underscore).

**Optional third beat — the spec change:**

> You are 'alice'. Call propose_spec_change with entry exactly 'GET /users/{id}', change set
> to this exact JSON text: {"id": "int", "name": "string"} and reason 'Email is PII and no
> longer needed'. Then re-save backend/api/users.py with the comment '# email intentionally
> omitted' above return jsonify.

The dashboard flashes "Needs your decision". Click it, then Accept. The coordinator
escalates the edit as a human decision instead of alerting bob, and the next edit to the file
is judged clean against the new shape.

## Reset between rehearsals

On the VM (`ssh root@172.237.146.90`, then `cd /opt/coordinator`):

```bash
docker compose exec app python backend/seed.py
docker compose exec app python -c "import sqlite3; c=sqlite3.connect('/app/data/coordinator.db'); c.executemany(\"INSERT INTO claims VALUES (?,?,?,datetime('now'))\", [('alice','backend/api/users.py','Owns GET /users/{id}'),('bob','frontend/src/components/UserCard.tsx','Renders user name and email')]); c.commit()"
```

On each laptop: `git reset --hard demo-seed && git clean -fd`

The claims matter. Without bob's, the alert names a file path instead of him.

## The live demo, three minutes

1. Dashboard on the projector, already open, sidebar showing **Live**. Both agent sessions
   already launched and connected.
2. Tell the story: two teammates, two agents, one API. About 20 seconds.
3. Paste alice's prompt. Her claim and edit appear on the feed as she works. About 25 seconds.
4. The banner flashes "Contract drift", the Alerts badge turns red, the map highlights the
   owner and consumers. Pause so the room sees it. About 15 seconds.
5. Paste bob's prompt. He reads the alert and fixes the card. About 40 seconds.
6. Name the challenges: AWS Strands for the coordinator, Akamai for hosting and inference.

About two and a half minutes in total. Skip the spec-change beat unless the story is running
short; it adds about a minute.

## Things that break it

- **Same clone on two laptops is fine; the same token on two laptops is not.** Identity is
  the token.
- **Do not start bob until the alert is on screen.** The verdict takes 8 to 18 seconds.
- **Repeated saves to `users.py` re-raise the same alert** until a proposal is accepted. That
  is by design; do not save twice.
- **Wifi.** Everything is on the VM. If the venue network dies, run the whole stack on the
  presenting laptop (`python -m backend.mcp` from the repo root, `npm run dev` in `frontend/`)
  and point both agents at `http://127.0.0.1:8000`.
