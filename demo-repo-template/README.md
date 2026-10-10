# demo-repo (live copy — gitignored by the outer repo on purpose)

This directory is a **template**. The live, agent-facing copy lives at `demo-repo/` (sibling of this directory, at the outer repo's root), which is excluded entirely from the outer repo's git tracking because it needs to be its own independent git repository — the hook script and `reset.sh` both shell out to `git diff`/`git reset --hard` scoped to it, and that must never entangle the outer repo's own history.

## One-time setup (every teammate, once, after pulling the outer repo)

```bash
cp -r demo-repo-template demo-repo   # run from the outer repo root
cd demo-repo
git init -q && git add -A && git commit -q -m "demo-seed" && git tag demo-seed
```

PowerShell:
```powershell
Copy-Item -Recurse demo-repo-template demo-repo
Set-Location demo-repo
git init -q; git add -A; git commit -q -m "demo-seed"; git tag demo-seed
```

Then set your bearer token(s) for this session (ask whoever owns the Server track for real values; any placeholder works against the local mock):

```bash
export CLAUDE_TEAM_TOKEN=<token>   # if running Claude Code here
export CODEX_TEAM_TOKEN=<token>    # if running Codex here
```

**Cross-platform note:** the hook commands in `.claude/settings.json` and `.codex/hooks.json` call `python3`. If `python3 --version` fails on your machine (common on stock Windows, where it's usually just `python`), change `python3` → `python` in both files before rehearsal — don't assume it resolves.

## Local mock `/events` (until the real one is live)

```bash
python3 hooks/mock_events_server.py     # :8787, always {"alerts": []}, logs every call
```

The MCP connection (`.mcp.json` / `.codex/config.toml`) points at `http://localhost:8000/mcp` — that's the Server track's `backend/mcp.py` run locally, which already works against real SQLite. No mock needed there.

## Repointing to the real `/events` (once the Server track ships it) — one env var, no file edits

```bash
export TEAM_EVENTS_URL=https://<real-host>/events
```

## Reset to the pristine demo state

```bash
./scripts/reset.sh
```

## The two seeded contracts (source of truth is `coordinator.db`'s `spec` table, seeded by `backend/seed.py` — see `spec/NOTES.md` for a human-readable mirror)

- `GET /users/{id}` — `backend/api/users.py` → `frontend/src/api/client.ts`, `frontend/src/components/UserCard.tsx`
- `GET /orders` — `backend/api/orders.py` → `frontend/src/api/client.ts`, `frontend/src/pages/Orders.tsx`

The live pitch drift: remove `email` from `backend/api/users.py`'s response — `UserCard.tsx` is the affected consumer.
