# Master Spec: Team Agent Coordinator (Hack Midwest 2026)

Oct 10, 2026 · @Aruneem

## Summary

We are building a coordination layer for a team's coding agents that catches contract drift while the agents are still editing, not at merge. "Team Agent Coordinator" is a working title.

**The gap.** Plenty of tools coordinate one person's agents. Nothing coordinates a team's agents, and that is the angle a room of 350 engineers will feel.

**The hero failure.** One teammate's agent changes an API response shape while another teammate's agent builds a frontend against the old shape. Nobody finds out until merge.

**The product has four parts:**

- **A shared living spec:** API contracts, the data model, and who owns what.
- **An MCP server:** each teammate's coding agent connects to declare intent, check for conflicts, and propose spec changes.
- **Agent hooks:** every file edit is reported to the server whether or not the agent chooses to call a tool, and pending alerts come back the same way.
- **A coordinator agent:** it judges whether an edit breaks a contract, alerts the affected agents, and escalates real decisions to humans.

The build targets the AWS Strands and Akamai Cloud challenges, $2,500 each. Agents in use are Claude Code and Codex. Submissions are due 8:00 AM Sunday, October 11.

## Prize tracks and rules

We are competing in two challenges, AWS Strands and Akamai Cloud AI, worth $2,500 each. All details below are from the [Hack Midwest site](https://hackmidwest.com/).

| Challenge | Prize | What the judges ask | How we meet it |
| --- | --- | --- | --- |
| AWS: Best Use of Strands Agents SDK | $2,500 | Does the project integrate the Strands Agents SDK? Is it unique, or does it use Strands creatively? | The coordinator is a Strands agent with its own tools. An agent that manages other agents is the creative use, and its tool calls show live on the dashboard. |
| Akamai Cloud AI | $2,500 | Impact and usefulness, use of Akamai Cloud resources and/or inference, technical execution, and creativity. It must go beyond a basic chatbot. | The server and dashboard run on a Linode VM, and the coordinator calls Akamai's hosted inference. The live demo proves it works, and it is an agent system, not a chatbot. |

DevRev, Flex, USDA, and the corporate trophies are not being pursued for now.

**Rules that shape the build:**

- **One project per team.** One build can target both challenges; the pitch names the sponsor challenges it involves.
- **Fresh code.** Nothing may be created before the official start. Third-party frameworks and libraries are allowed.
- **Web or mobile app.** The dashboard is the app.
- **Pitch.** Three minutes, no slide decks, shown from the working prototype, already signed in.
- **Judging.** Scored 0 to 10 on value and usefulness, innovation, and completeness as a real MVP. Code quality is not judged.
- **Hard stop.** No features or bug fixes after time ends, on pain of disqualification.
- **Team.** One to five people, all present in person.

**Schedule:** project checkpoint at 7:00 PM Saturday. Submissions due 8:00 AM Sunday. Demos begin 9:00 AM. Awards at 11:30 AM.

## Scope

We build one conflict type, contract drift, and make it work end to end on a tiny demo repo.

**In scope:**

- The MCP server with three or four tools.
- Edit-reporting hooks for Claude Code and Codex.
- The coordinator, detecting contract drift only.
- The live dashboard.
- A per-person bearer token, used for both access and identity.
- A small demo repo with one API and one frontend, plus a reset script.

**Out of scope:**

- Accounts, OAuth, or any auth beyond the shared tokens.
- Multi-repo support.
- Deep git integration.
- Other conflict types, such as two agents editing the same file.
- Automatic graph layout for arbitrary codebases.

## Architecture

One Python service and one React app, hosted on a single Akamai Linode VM. The AWS challenge names the Python SDK, and a single backend process is easy for four people to pick up.

&#91;embedded content: system architecture · 2 agents, 1 server, 1 dashboard\]

Agents on each laptop report edits through hooks. The server stores them, the coordinator judges them, and the dashboard shows the result.

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | FastAPI | One process serves the MCP endpoint, the hook endpoint, the dashboard API, and the live feed. |
| MCP server | FastMCP from the official MCP Python SDK, over streamable HTTP | Each tool is a decorated function, and every teammate's agent connects by URL. |
| Edit capture | PostToolUse hooks in each agent, with a `watchdog` script as fallback | Edits are reported whatever the agent decides to do, and alerts return on the same call. |
| Coordinator | [Strands Agents](https://strandsagents.com/docs/user-guide/sdk/quickstart/overview/), Python SDK | The state functions (read spec, list claims, raise alert) become its tools. |
| Model | Akamai hosted inference first, a stronger model if tool calling is flaky | The [Strands OpenAI provider](https://strandsagents.com/docs/user-guide/sdk/model-providers/openai/) takes a custom base URL. |
| State | SQLite | One file, no setup. Three tables: spec entries, claims, events. Spec entry fields are below, under "The shared spec." |
| Live updates | FastAPI WebSockets | The backend broadcasts every new event. Run a single worker so the broadcast reaches every client. |
| Frontend | React, Vite, Tailwind, and React Flow for the map | React Flow gives animated nodes and edges cheaply, and the map is the demo. |
| Hosting | One Linode VM with Caddy for HTTPS | Counts toward the Akamai challenge and gives the agents a public URL. |

**The path of one edit:**

1. An agent edits a file.
2. Its hook posts the edit to the server: who, which file, and the diff.
3. The server writes an event to SQLite and broadcasts it over the WebSocket.
4. A deterministic filter checks whether the file owns a contract in the spec.
5. If it does, the coordinator judges whether the contract changed and who is affected.
6. The dashboard shows the alert and the coordinator's reasoning.
7. The affected agent's next hook call returns the alert as context. The agent adapts, or the decision goes to a human.

## The shared spec

There is one spec, not one per agent. It lives in the server's database, and every agent, teammates' and the coordinator alike, reads the same rows. Nobody keeps a private copy, so nobody can disagree about what the old contract was.

**One entry, one contract:**

| Field | Example |
| --- | --- |
| `contract` | `GET /api/users` |
| `owner` | `api/users.py` — the file that implements it |
| `consumers` | `[frontend/UserCard.tsx]` — the files that depend on it |
| `shape` | `{id: int, name: str, email: str}` |

Hand-write these entries once at setup for the demo repo's one API. The spec stays small; it only needs an entry for contracts that cross a file boundary between teammates.

**Drift compares the edit to the stored `shape`, not to the old code.** The shape is the agreed contract. An edit is drift when it moves the owner file away from that shape in a way a consumer would notice — that is a semantic judgment, which is why it is the coordinator's job and not a text diff.

**The spec only changes when someone asks it to.** Catching drift never rewrites `shape` on its own. That only happens through `propose_spec_change`, which the coordinator routes to `escalate_to_human`. Until a human accepts the change, the same drift gets flagged again on the next edit, on purpose: the spec is the record of what the team agreed to, not a mirror of whatever the code currently does.

**Example, start to finish.** Teammate A's agent removes `email` from `api/users.py`. The hook reports the edit; the server sees `api/users.py` is an owner file and hands the diff plus the stored `shape` to the coordinator. The coordinator notices `email` is gone and that `UserCard.tsx` reads it, and raises an alert. Teammate B's agent gets that alert as plain text on its next hook call and fixes `UserCard.tsx`. The spec's `shape` still says `email` exists until someone calls `propose_spec_change` to accept the removal — until then, editing `api/users.py` again raises the same alert again.

## Agent integration

Hooks are the guarantee and MCP tools are the courtesy: every edit is reported by a hook, and agents call tools when they choose to.

**Why hooks.** The agent calls MCP tools; the server cannot interrupt a running session. A PostToolUse hook in each agent solves both directions. It posts the edit to the server, and it prints any pending alerts back into the agent's context. It also knows which agent made the edit, which a file watcher does not.

**MCP tools (draft, freeze before splitting up):**

| Tool | Purpose |
| --- | --- |
| `declare_intent(files, summary)` | Claim the files an agent is about to work on. |
| `check_conflicts(files)` | Return claims and open alerts that touch those files. |
| `get_spec(path)` | Read the contract a file owns or depends on. |
| `propose_spec_change(entry, change, reason)` | Ask to change a contract; the coordinator routes it. |

**Same state, no separate store.** The MCP tools only read and write the same spec, claims, and events tables the hooks already use. There's nothing extra to keep in sync.

**Tool calls are events too.** Every MCP tool call gets logged and broadcast exactly like a file edit, so a `check_conflicts` or `propose_spec_change` call shows up on the dashboard feed the same way an edit does.

**Hook endpoint (draft):** `POST /events` with the teammate's token, the agent name, the file path, and the diff. The response carries any alerts waiting for that teammate.

**Setup per agent:**

| Item | Claude Code | Codex |
| --- | --- | --- |
| MCP connection | `claude mcp add --transport http`, or a project `.mcp.json` | `[mcp_servers.<name>]` with `url` in `.codex/config.toml` |
| Token | Authorization header on the server entry | `bearer_token_env_var` on the server entry |
| Hook config | `.claude/settings.json`, PostToolUse on the edit tools | `.codex/hooks.json`, PostToolUse on `apply_patch` |
| Instructions | `CLAUDE.md` | `AGENTS.md` |
| Caveats | None known | Hooks are reported to be off by default behind a feature flag, and not to fire in `codex exec`. Verify on the installed version. |

**Identity.** Each teammate gets one bearer token. The server maps it to a name and a color, so claims and edits are attributed without any login flow.

**Instruction files.** They tell each agent to call `declare_intent` before starting work and `check_conflicts` before touching a contract file. Nothing in the demo depends on the agent obeying.

**Fallback.** If Codex hooks fail on our version, each teammate runs a small `watchdog` script that posts file changes. It cannot deliver alerts back, so Codex would then rely on `check_conflicts`.

## Coordinator

The coordinator has one job: given an edit to a file that owns a contract, decide whether the edit breaks that contract for a known consumer. It does not review code, scan the repo, or manage state; the server does that. It is the part the AWS judges score, so its tool calls are logged as events and shown on the dashboard.

**Trigger.** It runs only when the deterministic filter says a contract-owning file changed. Edits to that file are debounced so a burst of saves makes one call.

**Context, assembled by the server, not fetched by the model.** The coordinator never calls tools to gather context, which would add round trips against a tool-caller we haven't proven yet. Before the model runs, the server hands it everything in one shot: the diff hunk, the one spec entry the file owns, and that entry's consumers. Consumers come straight from the spec's `consumers` field, so "who is affected" is a lookup, not a reasoning step; the model only judges the shape question.

**Tools:** `raise_alert(summary, affected, suggested_fix)` and `escalate_to_human(question)`. No drift means no tool call, just a logged "checked, clean" event. Two tools keep the dashboard's tool-call trace meaningful instead of noisy, and keep the model's only real decision down to "which of two outcomes."

**Output of each run:** a verdict (drift or no drift), the affected teammates, a plain-language explanation, and a suggested fix.

**Model.** Start on Akamai's hosted inference through the Strands OpenAI provider. The [starter kit](https://github.com/akamai-developers/akamai-workshop-hackmidwest/blob/main/docs/inference.md) gives the connection:

- Base URL: `https://ws.akamai-workshops.com/v1`
- Model alias: `hackathon-chat`, which supports tool calls
- Auth: the team key as a bearer token, kept on the backend

**Limits to design around** (from the starter kit, to confirm against the live service):

| Limit | Value |
| --- | --- |
| Chat context, input plus output | 32,768 tokens |
| Chat output | 512 tokens by default, 4,096 maximum |
| Requests per team, all endpoints | 60 per minute |
| Chat tokens per team | 100,000 per minute |

Set `max_tokens` low (around 300 is enough for a short structured verdict), and send only the diff hunk and the one relevant spec entry, never whole files. The Responses API is not exposed, so use chat completions only.

**Fallback.** The backing model is unnamed, so its tool calling is unproven. If tool calls flake, parse a structured JSON reply instead and let the server pick the outcome — the same two outcomes land either way, so the demo doesn't depend on tool-calling actually working. If the first-hour smoke test is flaky even on plain completions, move the coordinator to Bedrock or an existing API key. Hosting on Linode still satisfies the Akamai criteria, and bringing your own inference is allowed.

**What this doesn't ask of other agents.** Nothing changes for the teammates' coding agents. The hook already reports every edit regardless of what the agent does, `declare_intent` and `check_conflicts` stay optional courtesy tools, and the alert returned on the next hook call is one plain sentence, not a payload to parse.

## Dashboard

The "mission control" dashboard must tell the story without narration, because the projector shows one screen and it will be this one.

- **Codebase map:** the demo repo's files as nodes, with each agent shown as a marker on the file it is touching.
- **Claimed regions:** files an agent has claimed, shaded in that teammate's color.
- **Spec panel:** the contracts, their owners, and any proposed changes.
- **Collision alert:** raised when drift is caught, with the coordinator's plain-language explanation.
- **Coordinator trace:** the coordinator's tool calls as they happen, so the Strands work is visible.

Hand-place 10 to 15 nodes for the demo repo rather than solving graph layout. Build the UI against a fake event generator first, so it never waits on the server.

## Demo and pitch

The pitch is three minutes with no slides, built around one live collision caught on screen.

**Script:**

1. Tell the problem as a short story: two teammates, two agents, one API.
2. Show the dashboard, already signed in, with both agents mid-task on the demo repo.
3. Give one agent a small prompt that changes the API response shape.
4. The dashboard flags the drift and shows the coordinator's explanation.
5. The second agent receives the alert and adapts its frontend code.
6. Name the challenges: AWS Strands and Akamai Cloud.
7. Close with "we built this using the tool itself", only if that is true by then.

**Preparation:**

- **Pre-stage both sessions.** An agent turn can take a minute or more and will not behave the same twice.
- **Reset script.** One command returns the demo repo and the database to the starting state.
- **Offline fallback.** The whole stack runs on one laptop in case the venue wifi fails.
- **Likely question.** "Why not contract tests in CI?" Those catch drift at merge; this catches it while the agent is still editing.

Do not depend on our own tool for building the project until it works.

## Risks and mitigations

The two risks most likely to sink the demo are the notification path and agent latency, so both get tested in the first hour.

| Risk | Mitigation | Owner |
| --- | --- | --- |
| No push channel to agents: the server cannot interrupt a running session. | PostToolUse hook reports the edit and returns pending alerts as context. | Agent integration |
| Codex hooks are newer and reportedly off by default. | Test on the installed version first; keep the `watchdog` script as fallback. | Agent integration |
| Live agents may not fit three minutes. | Pre-staged sessions, a tiny demo repo, one small trigger prompt, a reset script. | Dashboard and demo |
| Venue wifi fails during the pitch. | Whole stack runnable on one laptop. | Server |
| The Akamai model's tool calling is unproven, and output defaults to 512 tokens. | Smoke test in hour one, set `max_tokens`, send diffs only, switch models if flaky; if tool calls fail, parse a structured JSON reply as fallback. | Coordinator |
| The shared 60 requests per minute runs out. | Deterministic filter and debounce before any model call. | Coordinator |
| The server sits on the public internet with no auth. | Per-person bearer tokens, which also give identity. | Server |
| Akamai account activation lags. | Sign up immediately. | Server |
| Caddy needs a hostname to issue a certificate. | Settle the hostname with the stub deploy. | Server |
| FastMCP mounted inside FastAPI fails on lifespan or path setup. | Prove it with the stub before building tools. | Server |
| The codebase map eats the night. | Hand-placed nodes for the demo repo only. | Dashboard and demo |
| Less than 24 hours: the deadline is 8:00 AM, not a full day after kickoff. | Feature freeze at 4:00 AM. | Everyone |

## Team split and milestones

Four owners, one per layer, each starting with the spike that retires that layer's biggest risk.

| Role | Person | Owns | First-hour spike |
| --- | --- | --- | --- |
| Server |  | FastAPI, FastMCP tools, SQLite, WebSocket feed, Linode deploy, tokens | Stub MCP server live on a public URL |
| Agent integration |  | Claude Code and Codex configs, hooks, instruction files, `watchdog` fallback, demo repo | Both agents connect, and a hook fires on an edit |
| Coordinator |  | Strands agent, model provider, drift detection, spec schema, alerts | A Strands tool call working against `hackathon-chat` |
| Dashboard and demo |  | React app, map, spec panel, alerts, pitch script | UI rendering from a fake event generator |

Freeze the event schema, the tool names, and the endpoints together before splitting up. The coordinator and dashboard owners then build against fixtures, so nobody waits on the server.

**Milestones:**

- [ ] Before splitting up: event schema, tool names, and endpoints frozen
- [ ] First hour: all four spikes pass
- [ ] 7:00 PM Saturday (checkpoint): an edit in either agent shows up on the dashboard
- [ ] Midnight: the full drift scenario works once, end to end
- [ ] 4:00 AM Sunday: feature freeze
- [ ] 4:00 to 8:00 AM: the demo owner runs rehearsals; everyone else fixes only what rehearsals break
- [ ] 8:00 AM Sunday: submitted

## Open decisions

- [ ] Project name, replacing the working title
- [ ] Who takes each of the four roles
- [ ] Coordinator model: stay on `hackathon-chat` or switch, after the smoke test
- [ ] Codex hooks: confirmed working on our version, or fall back to `watchdog`
- [ ] Hostname for the Linode VM, so Caddy can issue a certificate
- [ ] What the demo repo's tiny app is
