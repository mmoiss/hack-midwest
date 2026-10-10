# Setup — getting from "code exists" to "ready to pitch"

This is for whoever is actually driving Claude Code or Codex during the live demo, and for whoever is running rehearsals. For general per-agent config reference (what `.mcp.json`, hooks, etc. look like and why), see `demo-repo-template/README.md` — this file is the checklist for turning that template into something three people can actually demo with.

## 1. Every presenting laptop needs its own `demo-repo/`

`demo-repo-template/` is tracked by this repo and is *not* what the agents edit. The live, agent-facing copy is `demo-repo/` — deliberately excluded from this repo's git (see root `.gitignore`) because it needs to be its own independent git repository, so the hook script and `reset.sh` can run `git diff`/`git reset --hard` against it without ever touching this outer repo's history.

**Whoever is driving Claude Code, and whoever is driving Codex, each need to do this once, on their own machine**, after pulling this repo:

```bash
cp -r demo-repo-template demo-repo   # from the repo root
cd demo-repo
git init -q && git add -A && git commit -q -m "demo-seed" && git tag demo-seed
```

PowerShell:
```powershell
Copy-Item -Recurse demo-repo-template demo-repo
Set-Location demo-repo
git init -q; git add -A; git commit -q -m "demo-seed"; git tag demo-seed
```

This has only been run in one development environment so far — **not yet on either presenting laptop.** Do this before the first rehearsal, not during it.

## 2. Confirm `python3` resolves on the actual presenting machine(s)

The hook commands in `demo-repo-template/.claude/settings.json` and `demo-repo-template/.codex/hooks.json` both call `python3`. That resolves on most Mac/Linux setups but not reliably on stock Windows, where it's often just `python`.

**Not yet checked on whatever laptop(s) will actually run the demo.** Before the first rehearsal on each presenting machine:

```bash
python3 --version
```

If that fails, edit both hook commands (`python3 hooks/report_edit.py ...` → `python hooks/report_edit.py ...`) in that machine's own `demo-repo/` copy. This is a one-line fix per file, but it has to be caught before someone's live edit silently produces no hook output.

## 3. The live drift-catch rehearsal is blocked on `/events` being real

**Update:** hook-firing itself is now confirmed live, against the real installed CLIs, not just by invoking the script directly. Ran a headless `claude -p` session and a headless `codex exec --dangerously-bypass-hook-trust` session, each against a mock server returning one real test alert (a verification token, not an empty `{"alerts": []}`), and had each agent quote back whatever alert text it received. Both did, verbatim — confirming `PostToolUse` fires on both CLIs and `hookSpecificOutput.additionalContext` reaches both agents' context (this was previously unconfirmed for Codex specifically). `CODEX_OUTPUT_MODE` can stay on its `json` default; no fallback to plain-text needed.

What's still unverified is everything downstream of the hook: the hook pipeline has only been run against a local mock server that always returns `{"alerts": []}` (or, for this test, one fixed fake alert) — it has never been run against the real coordinator, because the Server track hasn't built the `/events` custom route yet (confirmed: `backend/mcp.py` currently only implements the four MCP tools, no `/events` route).

**Do not treat a clean mock-server run as a rehearsal of the actual pitch moment.** The mock server can only confirm "the hook fires and posts a diff" — it cannot confirm the coordinator actually catches the `email`-removal drift, or that the dashboard shows it. That full chain needs, in order:

1. `/events` live (Server track)
2. Real bearer tokens issued and wired into both agents' configs (`CLAUDE_TEAM_TOKEN` / `CODEX_TEAM_TOKEN`), replacing the placeholder token used in local testing
3. `TEAM_EVENTS_URL` repointed from the local mock to the real server on every presenting machine
4. Only then: have an agent actually remove `email` from `backend/api/users.py` and confirm the dashboard flags it

Until step 1 lands, any "rehearsal" is really just confirming the hook plumbing works — valuable, but not the same thing as rehearsing the pitch. Don't let a few clean mock runs create false confidence that the live moment is ready.
