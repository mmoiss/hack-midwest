# demo-repo (live copy — gitignored by the outer repo on purpose)

This directory is a **template**. The live, agent-facing copy lives at `demo-repo/` (sibling of this directory, at the outer repo's root), which is excluded entirely from the outer repo's git tracking because it needs to be its own independent git repository — the hook script and `reset.sh` both shell out to `git diff`/`git reset --hard` scoped to it, and that must never entangle the outer repo's own history.

## The short version

```bash
cp -r demo-repo-template demo-repo && cd demo-repo
git init -q && git add -A && git commit -q -m demo-seed && git tag demo-seed
cp .env.example .env          # paste your token in, leave the server URLs
./demo.sh up                  # or .\demo.ps1 up -- launches Claude Code or Codex, connected
./demo.sh reset               # this clone and the server back to the demo start
./demo.sh status              # who you are, server health, is the clone clean
```

`demo.sh` / `demo.ps1` read `.env`, export what the CLI and the hook need, point Codex's
config at the server, and reset through `POST /api/reset` with your token, so nobody needs
SSH, Docker or a local database. The rest of this file is the long version.

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

**If you already have a `demo-repo/` from before, don't assume it's current.** It's a one-time
copy, not something that stays in sync with this template -- a fix landing here (like the
`reset.sh` claim-reseed fix) does nothing for a `demo-repo/` copied before that fix existed.
`diff -rq demo-repo-template/ demo-repo/ --exclude=.git` from the outer repo root shows any
drift; re-copy (or at least re-copy the specific stale file) before trusting a rehearsal.

Then set your env vars for this session (copy `.env.example` to `.env` for your own reference,
but export them yourself -- neither Claude Code nor Codex loads `.env` files automatically):

```bash
export CLAUDE_TEAM_TOKEN=<token>          # if running Claude Code here
export CODEX_TEAM_TOKEN=<token>           # if running Codex here
export TEAM_MCP_URL=http://localhost:8000/mcp     # what .mcp.json's `url` reads (Claude Code only)
```

Ask whoever owns the Server track for real token values; any placeholder works against the
local mock. **Codex's `.codex/config.toml` does not support this substitution** -- its `url`
is a plain literal string, so pointing Codex's MCP connection somewhere other than localhost
means editing that file directly. That's a lower-stakes edit than `.mcp.json` ever was: the
token there is already indirected through `bearer_token_env_var`, so there's no secret to leak,
only a hostname.

**Cross-platform note:** the hook commands in `.claude/settings.json` and `.codex/hooks.json` call `python3`. If `python3 --version` fails on your machine (common on stock Windows, where it's usually just `python`), change `python3` → `python` in both files before rehearsal — don't assume it resolves.

**Testing Codex headlessly needs two bypass flags together, not one.** `codex exec "..." --dangerously-bypass-approvals-and-sandbox` alone gets MCP tool calls (`declare_intent`, etc.) through, but `PostToolUse` never fires on `apply_patch` -- no hook call, no `edit` event, nothing delivered back. Hooks need `--dangerously-bypass-hook-trust` as well:

```bash
codex exec "..." --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox
```

Confirmed by actually running both halves (MCP tools and hooks) in the same headless session --
each flag alone is not enough on its own for the full rehearsal, and testing with only one
makes the other half look like it's working when it was simply never exercised.

## Local mock `/events` (until the real one is live)

```bash
python3 hooks/mock_events_server.py     # :8787, always {"alerts": []}, logs every call
```

The MCP connection defaults to `http://localhost:8000/mcp` — that's the Server track's `backend/mcp.py` run locally, which already works against real SQLite. No mock needed there. `.mcp.json`'s `url` reads `${TEAM_MCP_URL}` (defaulted above); `.codex/config.toml`'s `url` is the literal `http://localhost:8000/mcp`.

## Repointing to the real server, instead of local — env vars only, never a file edit

```bash
export TEAM_EVENTS_URL=https://<real-host>/events     # the hook endpoint
export TEAM_MCP_URL=https://<real-host>/mcp           # .mcp.json's MCP connection (Claude Code)
```

For Codex, edit `.codex/config.toml`'s `url` directly -- again, no secret involved there.

**Never hand-edit `.mcp.json` to point at a real server, and never paste a real token into
it.** It's a tracked file. A real production URL and bearer token ended up hardcoded into it
this way once already, sitting in a tracked file waiting to be committed by an unrelated
`git add -A`. Use the env var above instead -- that's the entire reason it's parameterized.

## Reset to the pristine demo state

```bash
./demo.sh reset        # .\demo.ps1 reset in PowerShell; scripts/reset.sh is now a wrapper for this
```

## The two seeded contracts (source of truth is `coordinator.db`'s `spec` table, seeded by `backend/seed.py` — see `spec/NOTES.md` for a human-readable mirror)

- `GET /users/{id}` — `backend/api/users.py` → `frontend/src/api/client.ts`, `frontend/src/components/UserCard.tsx`
- `GET /orders` — `backend/api/orders.py` → `frontend/src/api/client.ts`, `frontend/src/pages/Orders.tsx`

The live pitch drift: remove `email` from `backend/api/users.py`'s response — `UserCard.tsx` is the affected consumer.
