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
2. `cp .env.example .env` and paste your token into it: `CLAUDE_TEAM_TOKEN=` for Claude
   Code, `CODEX_TEAM_TOKEN=` for Codex. The server URLs are already filled in.
3. Check `python3 --version` works in the shell you will use. Both hook configs call
   `python3`; if it fails (stock Windows), change it to `python` in `.claude/settings.json`
   and `.codex/hooks.json`.

That is all. No variables to export, no config file to edit: the launcher does both.

## Each laptop, every session

```
./demo.sh up          Git Bash, macOS, Linux
.\demo.ps1 up         PowerShell
```

It prints which CLI it is launching and who the server says you are, then opens the agent
connected to the server. If it says the token was rejected, fix `.env` and run
`./demo.sh status`.

## The prompts

**Laptop A, ogo — the breaking edit:**

> You are the teammate 'ogo'. Per CLAUDE.md, call declare_intent for backend/api/users.py
> with a one-line summary, then check_conflicts for it. Then make one minimal edit: remove
> the 'email' entry from the JSON response in get_user in backend/api/users.py. Touch no
> other file. Finish with one sentence: what you changed and anything the coordinator told
> you.

Wait until the alert appears on the dashboard (8 to 18 seconds). Then:

**Laptop B, sandi — the adaptation:**

> You are the teammate 'sandi'. Per AGENTS.md, first call check_conflicts for
> frontend/src/components/UserCard.tsx and read the result. If it reports an open alert for
> you, make one minimal edit to UserCard.tsx so the component no longer depends on the field
> the API dropped. Do not edit any backend file. Quote any [team-coordinator] message that
> appears, then one sentence on what you changed.

If the roles are swapped: Claude Code reads `CLAUDE.md`, Codex reads `AGENTS.md`, and Codex
registers the server as `team_coordinator` (underscore).

**Optional third beat — the spec change:**

> You are 'ogo'. Call propose_spec_change with entry exactly 'GET /users/{id}', change set
> to this exact JSON text: {"id": "int", "name": "string"} and reason 'Email is PII and no
> longer needed'. Then re-save backend/api/users.py with the comment '# email intentionally
> omitted' above return jsonify.

The dashboard flashes "Needs your decision". Click it, then Accept. The coordinator
escalates the edit as a human decision instead of alerting sandi, and the next edit to the file
is judged clean against the new shape.

## Reset between rehearsals

On every laptop that took part:

```
./demo.sh reset       or  .\demo.ps1 reset
```

The first one to run it resets the server too (contracts restored, events cleared, ogo's
and sandi's claims back in place); the others just reset their own clone. Nobody needs SSH.
Then reload the dashboard page.

## The live demo, three minutes

1. Dashboard on the projector, already open, sidebar showing **Live**. Both agent sessions
   already launched and connected.
2. Tell the story: two teammates, two agents, one API. About 20 seconds.
3. Paste ogo's prompt. The claim and edit appear on the feed as the agent works. About 25 seconds.
4. The banner flashes "Contract drift", the Alerts badge turns red, the map highlights the
   owner and consumers. Pause so the room sees it. About 15 seconds.
5. Paste sandi's prompt. The agent reads the alert and fixes the card. About 40 seconds.
6. Name the challenges: AWS Strands for the coordinator, Akamai for hosting and inference.

About two and a half minutes in total. Skip the spec-change beat unless the story is running
short; it adds about a minute.

## Things that break it

- **Same clone on two laptops is fine; the same token on two laptops is not.** Identity is
  the token.
- **Do not start sandi until the alert is on screen.** The verdict takes 8 to 18 seconds.
- **Repeated saves to `users.py` re-raise the same alert** until a proposal is accepted. That
  is by design; do not save twice.
- **Antivirus HTTPS scanning.** If `demo status` is fine but Claude Code says the MCP server
  "connection timed out (CONNECT_TIMEOUT)", the laptop's antivirus is intercepting HTTPS
  (Norton Web Shield did this on 2026-10-11). Exclude `172-237-146-90.sslip.io` from its SSL
  scanning, or see INTEGRATION.md for the SSH-tunnel workaround. Codex keeps working but logs
  `rmcp` errors; ignore those.
- **Wifi.** Everything is on the VM. If the venue network dies, run the whole stack on the
  presenting laptop (`python -m backend.mcp` from the repo root, `npm run dev` in `frontend/`),
  and in each clone's `.env` switch the two URLs to `http://127.0.0.1:8000/...`.
