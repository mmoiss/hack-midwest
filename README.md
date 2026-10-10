# Project Title & Elevator Pitch

**Skeg is a live coordination dashboard for development teams using multiple coding agents, making shared API contracts, conflicting changes, and affected teammates visible before integration breaks.**

*Don't keel over, **skeg**.*

**Team AMOS:** Aruneem, Matthew, Ogochukwu, and Sandi · Hack Midwest 2026

## Inspiration

Working in parallel makes a team faster until one teammate's coding agent changes an API response while another builds a frontend against its old shape. Both changes can look correct in isolation, and Git can merge them cleanly, yet the application breaks.

We chose this problem because hackathons and small teams feel it immediately: fast edits, limited time to coordinate, and several agents with different context. Skeg gives them a shared contract and makes the consequences of a change visible while the work is happening.

## What it does

- **Shares contracts:** records each API's agreed response shape, implementation file, and dependent files in SQLite.
- **Tracks intent:** MCP tools let agents declare files they plan to change, inspect other agents' claims, read contracts, and propose changes.
- **Captures edits:** Claude Code and Codex hooks report diffs independently of whether an agent chooses to call an MCP tool.
- **Reviews contract drift:** the Strands coordinator implementation compares edits against agreed shapes and can raise an alert or ask for a human decision.
- **Explains the impact:** the dashboard shows activity, proposals, and alerts. Its map highlights contract owners and consumers, animates affected dependency edges, and focuses on selected alerts.
- **Preserves provenance:** alerts record the contract, owner, consumers, and originating edit ID so their map context survives reloads and later spec changes.
- **Returns feedback to agents:** pending alerts are delivered through each affected agent's next hook request, with delivery tracked separately per agent.

The primary flow is: **declare intent → edit → report the diff → review the contract → inspect affected files → adapt or request a human decision.**

**Current status:** the seeded dashboard and database-to-SSE updates work. MCP and hook routes exist, and the Strands coordinator runs separately against fixtures. The live hook's `judge_edit` still contains a `checked_clean` stub; connecting it to `run_coordinator` is required for live AI drift detection. Accept, Reject, and Resolve controls await backend decision routes. Seeded alerts demonstrate the map rather than proving that unfinished integration.

## How we built it

| Technology | Where we use it |
|---|---|
| React 19, TypeScript, Vite | Dashboard components and local development server. |
| Tailwind CSS v4 | Styling, theme colors, and layout. |
| React Flow | Interactive dependency graph, highlighted nodes and edges, and camera navigation. |
| Zustand | Shared UI state and snapshot/incremental event handling. |
| jsdiff | Text comparisons in proposed contract changes. |
| Node.js, `node:sqlite`, Server-Sent Events | A read-only adapter polls SQLite and streams updates to the browser. |
| Python, FastMCP | Four MCP tools, bearer-token identity, `/events` hooks, and `/health`. |
| Strands Agents SDK | Coordinator with `raise_alert` and `escalate_to_human` tools and a structured-output fallback. |
| Akamai hosted inference | Default coordinator model, accessed through Strands' OpenAI-compatible provider. |
| SQLite in WAL mode | Contracts, claims, events, and alert delivery; Python writes while Node reads. |
| Docker Compose, Caddy, Akamai Linode | Target hosting: containers on one VM, HTTPS routing, and persistent storage. Current Compose includes Python and Caddy; dashboard deployment is pending. |

```text
Coding agents ── MCP tools / edit hooks ──> Python service
                                              │
                                   contract review + events
                                              │
                                              v
                                            SQLite
                                              │ read-only
                                              v
                                      Node SSE adapter
                                              │
                                              v
                                        React dashboard
```

The architecture targets the **AWS Strands** and **Akamai Cloud AI** challenges: Strands powers the coordinator's tool-based decisions, while the deployment design combines Linode compute with Akamai inference. [CONTRACT.md](CONTRACT.md) defines the integration boundaries; [SPEC.md](SPEC.md) explains the product design.

## Challenges we ran into

- **Aligning frontend and backend:** an earlier roadmap described WebSockets and FastAPI, while the frozen contract uses SSE and FastMCP. We aligned the dashboard adapter with the shared SQLite contract.
- **Finding the actual source of a break:** an affected teammate can claim several unrelated files. We replaced claim-based guesses with contract and edit provenance captured during review and carried through SQLite, SSE, and the map.
- **Concurrent reviews:** tools can execute on worker threads. Each review's tools capture their own context so an alert cannot inherit another edit's identity.
- **Database location mismatches:** different defaults could leave the dashboard reading the wrong database. We aligned local defaults and added configurable `DB_PATH` handling.
- **Python module shadowing:** running `backend/mcp.py` directly can shadow the installed `mcp` package. Running `python -m backend.mcp` from the repository root avoids that collision.
- **Cross-platform behavior:** Windows exposed database cleanup timing and shell differences. Tests explicitly close connections and allow SSE connections to release their files; setup commands below cover both Bash and PowerShell.

## Accomplishments that we're proud of

- Built a dashboard that turns a contract break into visible owner-to-consumer relationships and direct navigation to the affected area.
- Preserved original alert context even after the current contract changes.
- Verified SQLite → SSE → frontend state updates, reconnects, and database startup recovery.
- Tested provenance isolation across concurrent tool calls and the structured-output fallback.
- Created a repeatable seeded demo with three teammates and two different contract-break scenarios.

## What we learned

- Shared interface contracts are especially valuable when teammates build different layers in parallel.
- Ownership and edit identity should come from instrumentation; the model's job is semantic judgment.
- Notification delivery and actual resolution need separate state.
- SSE and SQLite WAL can support a small live dashboard without another database or a WebSocket service.
- Build checks, model fixtures, and full live rehearsals answer different questions; each needs its own verification.

## What's next for Skeg

1. Connect live hook reviews to Strands and rehearse the complete edit → alert → agent adaptation cycle.
2. Implement authenticated human decisions, persisted proposal outcomes, and explicit alert resolution.
3. Deploy the dashboard alongside Python on Linode and verify inference from the deployed application.
4. Display coordinator tool results, notification delivery, and measured detection latency.
5. Add claim expiry and reliable agent activity, then explore broader repository discovery and multi-repository support.

## Installation / Setup Instructions

### Prerequisites

- Git.
- **Python 3.12+**; the container uses 3.12 and local tests also ran on 3.13.
- **Node.js 24.13+ in the Node 24 release line**, with npm, matching the tested runtime and its built-in SQLite/TypeScript support.
- An Akamai inference key only for real coordinator fixtures. The seeded dashboard needs no model credentials.

### 1. Clone and install

**macOS/Linux — Bash:**

```bash
git clone https://github.com/mmoiss/hack-midwest.git
cd hack-midwest
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt "python-dotenv[cli]"
cp .env.example .env
cp frontend/.env.example frontend/.env
cd frontend
npm ci
cd ..
```

**Windows — PowerShell:**

```powershell
git clone https://github.com/mmoiss/hack-midwest.git
Set-Location hack-midwest
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt "python-dotenv[cli]"
Copy-Item .env.example .env
Copy-Item frontend/.env.example frontend/.env
Set-Location frontend
npm.cmd ci
Set-Location ..
```

PowerShell uses the virtual environment's executable directly, so no activation script is required.

### 2. Configure environment variables

Generate a token table from the repository root:

```bash
# Bash, with the virtual environment activated
python scripts/make_tokens.py alice bob carol
```

```powershell
# PowerShell
.\.venv\Scripts\python.exe scripts/make_tokens.py alice bob carol
```

Replace the existing `TEAM_TOKENS` line in the root `.env` with the generated line. Give each agent its own printed token. The `frontend/.env` example is sufficient for the seeded dashboard; its token table only supplies agent colors to the server-side adapter.

For real inference, set `AKAMAI_TEAM_KEY` in the root `.env`; retain `COORDINATOR_MODEL_PROVIDER=akamai` and the supplied `AKAMAI_BASE_URL`. `DOMAIN` is only used for Caddy deployment.

The default database is `coordinator.db` in the repository root. For a custom location, set the same **absolute** `DB_PATH` in both `.env` files. Leave `COORDINATOR_DB_PATH` unset unless intentionally using a separate fixture database. Model keys and backend configuration stay out of browser-exposed `VITE_*` variables.

### 3. Seed the manual demo

Run once on a fresh checkout. **Seeding resets the selected database's contracts, claims, and events**; stop the backend before reseeding an existing demo.

```bash
# Bash, repository root
python -m dotenv -f .env run -- python -m backend.seed
```

```powershell
# PowerShell, repository root
.\.venv\Scripts\python.exe -m dotenv -f .env run -- .\.venv\Scripts\python.exe -m backend.seed
```

This creates Alice, Bob, and Carol's claims, two contracts, and 12 events, including two alerts with recorded owner, consumer, and edit context.

### 4. Start the dashboard

Open a terminal at the repository root:

```bash
# Bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

```powershell
# PowerShell
Set-Location frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173**. Choose **Alerts → Show on map** and inspect both users and orders alerts. Owners have amber borders, consumers have red borders, and affected edges animate. Click an edge to inspect its alert or a file path to focus that file.

Vite serves both the UI and `/api/stream`; no separate Node server is needed locally. The seeded dashboard works without starting Python or calling a model.

### 5. Start the MCP/hook backend

In a second terminal, from the repository root:

```bash
# Bash
source .venv/bin/activate
python -m dotenv -f .env run -- python -m backend.mcp
```

```powershell
# PowerShell
.\.venv\Scripts\python.exe -m dotenv -f .env run -- .\.venv\Scripts\python.exe -m backend.mcp
```

Check **http://127.0.0.1:8000/health**. MCP is at `http://127.0.0.1:8000/mcp`; hooks POST to `http://127.0.0.1:8000/events`. The launcher explicitly loads `.env` because `backend.mcp` reads environment variables at import time.

For coding agents, create an isolated working copy using [demo-repo-template/README.md](demo-repo-template/README.md). Set `TEAM_EVENTS_URL=http://127.0.0.1:8000/events` and the appropriate `CLAUDE_TEAM_TOKEN` or `CODEX_TEAM_TOKEN`. Point both clients' MCP configuration at this same server: the checked-in Claude template currently targets a remote endpoint, while Codex targets localhost. On Windows, replace `python3` in copied hook commands if that executable is unavailable.

The current live review stub reports `checked_clean`; starting Python alone does not enable AI drift detection. To exercise the separate coordinator with real inference credentials:

```bash
# Bash, repository root; makes a real inference request
python backend/run_fixture.py drop_email
```

```powershell
# PowerShell; makes a real inference request
.\.venv\Scripts\python.exe backend/run_fixture.py drop_email
```

Fixtures default to an isolated `coordinator_fixture.db`, so they do not populate the dashboard's normal database.

### 6. Run checks

```bash
# Bash, repository root with virtual environment activated
python -m unittest backend.test_alert_context -v
cd frontend
npm test
npm run build
```

```powershell
# PowerShell, repository root
.\.venv\Scripts\python.exe -m unittest backend.test_alert_context -v
Set-Location frontend
npm.cmd test
npm.cmd run build
```

Tests use temporary databases and mocked inference. The build checks TypeScript and generates `frontend/dist`; serving those assets and the SSE adapter together still requires the dashboard deployment work described above.
