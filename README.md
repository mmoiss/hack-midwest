**Skeg is a live coordination dashboard for development teams using multiple coding agents, making shared API contracts, conflicting changes, and affected teammates visible before integration breaks.**

*Don't keel over, **skeg**.*

**The Captains:** Aruneem, Matthew, Ogochukwu, and Sandi

## Inspiration

Working in parallel makes a team faster until one teammate's coding agent changes an API response while another builds a frontend against its old shape. Both changes can look correct in isolation, and Git can merge them cleanly, yet the application breaks.

We chose this problem because hackathons and small teams feel it immediately: fast edits, limited time to coordinate, and several agents with different context. Skeg gives them a shared contract and makes the consequences of a change visible while the work is happening.

## What it does

- **Shares contracts:** records each API's agreed response shape, implementation file, and dependent files in SQLite.
- **Tracks intent:** MCP tools let agents declare files they plan to change, inspect other agents' claims, read contracts, and propose changes.
- **Captures edits:** Claude Code and Codex hooks report diffs independently of whether an agent chooses to call an MCP tool.
- **Reviews contract drift:** the *AWS Strands* coordinator implementation compares edits against agreed shapes and can raise an alert or ask for a human decision.
- **Explains the impact:** the dashboard shows activity, proposals, and alerts. Its map highlights contract owners and consumers, animates affected dependency edges, and focuses on selected alerts.
- **Preserves provenance:** alerts record the contract, owner, consumers, and originating edit ID so their map context survives reloads and later spec changes.
- **Returns feedback to agents:** pending alerts are delivered through each affected agent's next hook request, with delivery tracked separately per agent.

The primary flow is: **declare intent → edit → report the diff → review the contract → inspect affected files → adapt or request a human decision.**

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
| *Akamai hosted inference* | Default coordinator model, accessed through Strands' OpenAI-compatible provider. |
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
