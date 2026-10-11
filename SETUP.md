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

## 3. The live drift-catch rehearsal — no longer blocked

**Update:** hook-firing itself is now confirmed live, against the real installed CLIs, not just by invoking the script directly. Ran a headless `claude -p` session and a headless `codex exec --dangerously-bypass-hook-trust` session, each against a mock server returning one real test alert (a verification token, not an empty `{"alerts": []}`), and had each agent quote back whatever alert text it received. Both did, verbatim — confirming `PostToolUse` fires on both CLIs and `hookSpecificOutput.additionalContext` reaches both agents' context (this was previously unconfirmed for Codex specifically). `CODEX_OUTPUT_MODE` can stay on its `json` default; no fallback to plain-text needed.

**Second update — step 1 below is now done.** `/events` is live on a public HTTPS URL and has
been exercised end to end from a second machine: an edit removing `email` from the
contract-owning file was judged by the real Akamai `hackathon-chat` model, which raised an
alert naming the affected teammate with a concrete fix, and that alert was delivered to the
other agent on its next hook call. So the chain below is no longer theoretical — but steps 2
and 3 are still per-machine work nobody has done on the presenting laptops.

```
https://172-237-146-90.sslip.io/events
```

**Do not treat a clean mock-server run as a rehearsal of the actual pitch moment.** The mock
server can only confirm "the hook fires and posts a diff" — it cannot confirm the coordinator
actually catches the `email`-removal drift, or that the dashboard shows it. That full chain
needs, in order:

1. ~~`/events` live (Server track)~~ — **done**, see `INTEGRATION.md`
2. Real bearer tokens issued and wired into both agents' configs (`CLAUDE_TEAM_TOKEN` / `CODEX_TEAM_TOKEN`), replacing the placeholder token used in local testing — **tokens exist**, one per teammate, generated on the VM; they have to be handed out and pasted in
3. `TEAM_EVENTS_URL` repointed from the local mock to the real server on every presenting machine
4. Only then: have an agent actually remove `email` from `backend/api/users.py` and confirm the dashboard flags it

Two behaviours the mock could not have taught you, now that the server is real:

- **Errors are real.** An unknown or missing token returns `401`; a body that is not JSON, or
  has no `file`, returns `400`. The mock always returned `200`, so a misconfigured token used
  to look identical to a working one.
- **Have the demo agents call `declare_intent` before editing.** `affected` is resolved from
  the `claims` table. A consumer file nobody has claimed falls back to its raw file path,
  which no agent matches — so the teammate who would have been alerted isn't. Declaring intent
  first is what makes the alert land on a person.

Step 4 is still the one that matters, and it still has not been rehearsed on the presenting
laptops. A working server does not mean a working demo.

## 4. Standing the server up from scratch

The server is already deployed; this section is so it can be rebuilt — a lost VM, a second
environment, or the offline-laptop fallback. Operational detail and the reasoning behind
these choices is in `INTEGRATION.md`.

### 4.1 Create the Linode

Akamai Cloud Manager → **Create → VM** (not a Marketplace app — you need a bare machine):

| Field | Value |
|---|---|
| Region | **US, Chicago, IL (`us-ord`)** — closest to the venue |
| Image | Ubuntu 24.04 LTS |
| Plan | **Shared CPU → Linode 2GB** — this is `g6-standard-1` |
| Label | `coordinator` |
| Auth | root password, and an SSH key if you want to stop typing it |

Expand **Add User Data** and paste `deploy/cloud-init.yaml` verbatim. `#cloud-config` must be
the first line or cloud-init ignores the whole file silently. This field **cannot be edited
after creation** — get it right before clicking Create. (If the field is missing, the region
doesn't expose the Metadata service; install `docker.io` and `docker-compose-v2` by hand.)

A **firewall is required** to create the Linode. Inbound: accept TCP **22, 80, 443**.
Outbound: accept all — Docker pulls images and the coordinator calls
`ws.akamai-workshops.com`.

> Adding the accept rule is not enough on its own: also set the firewall's **default inbound
> policy to DROP**, or everything stays open and the rule is decorative. Save the port-22 rule
> *before* flipping the policy, or you lock yourself out of SSH. You cannot tell which state
> you are in from the UI — probe a port you never allowed (say 9999) from another machine: a
> *refused* connection means the policy is still ACCEPT, a *timeout* means DROP is working.

**Port 80 must be open even though everything is HTTPS.** Let's Encrypt proves domain control
over plain HTTP on port 80. Closed, Caddy never gets a certificate — and that failure surfaces
much later, looking like a Caddy bug.

### 4.2 Verify the boot

```bash
ssh root@<IP>
cloud-init status --wait
docker --version && docker compose version && ls -ld /opt/coordinator
```

Linode's Ubuntu images have **no `ubuntu` user** — you are root. `docker compose version`
(v2 plugin, not `docker-compose`) is what `compose.yaml` needs. `/opt/coordinator` existing
proves `runcmd` ran, not just the package install. If Docker is missing,
`tail -40 /var/log/cloud-init-output.log`.

### 4.3 Get the code

The repo is **private**, so HTTPS cloning prompts for credentials that no longer work.
Use a read-only deploy key:

```bash
ssh-keygen -t ed25519 -C "coordinator-vm" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that under the repo's **Settings → Deploy keys**, leaving *Allow write access* unchecked.
Then:

```bash
cd /opt/coordinator
git clone git@github.com:mmoiss/hack-midwest.git .
ssh -T git@github.com    # if the clone fails, this tells you whether the key is registered
```

### 4.4 Write `.env`

```bash
python3 scripts/make_tokens.py aruneem matthew sandi ogo > .env
```

The `TEAM_TOKENS=` line goes into the file; each person's token prints to the terminal.
**Copy those off the screen** — re-running generates entirely different tokens and invalidates
any you already handed out. Keep the names aligned with `demo-repo/scripts/reset.sh`'s
claims (`aruneem`, `matthew`, `sandi`, `ogo`) so the demo's lookups resolve.

Then append the rest:

```bash
echo 'DOMAIN=<ip-with-dashes>.sslip.io' >> .env
echo 'COORDINATOR_MODEL_PROVIDER=akamai' >> .env
echo 'AKAMAI_TEAM_KEY=<the team-31 key>' >> .env
cat .env
```

`DOMAIN` needs **no DNS record**: sslip.io reads the IP out of the hostname, so
`203.0.113.5` becomes `203-0-113-5.sslip.io` and resolves immediately. It is a real public
name, so Let's Encrypt issues a genuinely trusted certificate for it.

Check that `TEAM_TOKENS=` is **single-quoted**. The colors are hex, and an unquoted `#` reads
as a comment — the JSON truncates, the server starts fine, and every token is rejected. That
looks like an auth bug and isn't.

### 4.5 Start, seed, verify

```bash
docker compose up -d --build
docker compose exec app python backend/seed.py
curl -s https://<DOMAIN>/health
```

Expect `"status":"ok"`, `"journal_mode":"wal"`, `"inference":{"configured":true}`,
`"tokens_loaded":4`, and `"events"` well above zero. **`"events":0` after seeding means the
seed hit the wrong database** — see `INTEGRATION.md`.

Without the seed the `spec` table is empty, and `/events` only calls the coordinator for files
that *own* a contract. Every edit would log and return no alerts, which looks exactly like a
broken coordinator.

**Tear down with `docker compose down` — never `down -v`.** The `-v` destroys the volume
holding your TLS certificate, and Let's Encrypt allows only about five identical certs a week.

### 4.6 Smoke test from a second machine

In any project folder, `.mcp.json`:

```json
{
  "mcpServers": {
    "coordinator": {
      "type": "http",
      "url": "https://<DOMAIN>/mcp",
      "headers": { "Authorization": "Bearer <that person's token>" }
    }
  }
}
```

`/mcp` with **no trailing slash** — `/mcp/` returns `307` and not every client follows it.
`/mcp` in Claude Code should list four tools; asking the agent to call `declare_intent`
should come back attributed to whoever owns that token, not to any name the agent supplied.

## 5. Running the server and dashboard together on one laptop

This is the offline fallback SPEC.md calls for if venue wifi fails, and it's also how you'd
rehearse the dashboard locally before a Linode box exists. Two processes, run from the repo
root and `frontend/` respectively:

```bash
python -m backend.mcp        # from the repo root
```
```bash
npm run server                # from frontend/
```

**Both must agree on where `coordinator.db` is.** With no `DB_PATH` set anywhere, they now
default to the same file (`<repo-root>/coordinator.db`) — fixed as part of #13; previously
the dashboard defaulted to a different, nonexistent path and would silently show nothing
while the server worked fine. If you do set `DB_PATH` (for either `.env`), set it to the
same value in both — see the comments in `.env.example` and `frontend/.env.example`.

To confirm it's actually wired up: run `python backend/seed.py` once, then open the
dashboard (`npm run dev` in `frontend/`) and confirm the two contracts' files appear on
the Map (seed.py writes no agents or events; those only come from real tool calls). An
empty dashboard with a server that starts cleanly is the exact symptom of a `DB_PATH`
mismatch, not a crash you'd notice otherwise.
