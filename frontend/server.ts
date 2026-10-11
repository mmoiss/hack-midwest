// Dashboard server: reads the coordinator's SQLite file (read-only) and pushes
// it to the browser over Server-Sent Events, per SPEC.md. Python is the only writer.
//   GET /api/stream  ->  `snapshot` first, then one message per new `events` row.
// In dev, vite.config.ts mounts `stream` directly; `npm run server` runs it standalone.
// Human decisions (Accept/Reject, Mark resolved) never come here: the browser POSTs them
// to the Python server's /api/proposals and /api/alerts routes, and the resulting
// proposal_decision / alert_resolved rows flow back through this feed like any other.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Must match backend/mcp.py's default exactly: that server runs as `python -m backend.mcp`
// from the repo root, so its unset-DB_PATH default resolves to <repo-root>/coordinator.db.
// This used to point at <repo-root>/backend/coordinator.db instead -- a different, nonexistent
// file -- so a local run with no env vars set had the dashboard silently reading nothing while
// the server worked fine. See issue #13.
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../coordinator.db', import.meta.url))
const PORT = Number(process.env.PORT ?? 3001)
const NP = '[NOT PROVISIONED]'

// Event authors that are not teammates' coding agents, so they never join the crew list.
// 'human' is a person clicking a dashboard button (backend/mcp.py _decider); 'coordinator'
// is the reviewing Strands agent, which narrates itself through events (review_started,
// tool calls, alerts, checked_clean) — those still reach the Feed, it just gets no crew
// entry or agent page of its own.
const HIDDEN_AGENTS = new Set(['human', 'coordinator'])

type Row = { id: number; ts: string; agent: string; type: string; payload: string }
type Msg = { type: string; data: any }

// TEAM_TOKENS, the same env var the Python server reads: token -> {name, color}.
function parseColors(teamTokens = '{}'): Record<string, string> {
  try {
    return Object.fromEntries(Object.values(JSON.parse(teamTokens) as Record<string, { name: string; color: string }>).map((t) => [t.name, t.color]))
  } catch (e) {
    console.warn(`TEAM_TOKENS is not valid JSON, agents will be gray: ${e}`)
    return {}
  }
}
let COLORS: Record<string, string> = {}
// `status` is derived in the browser (store.ts agentStatus) from claims, touches and open
// alerts, and `task` is the agent's latest declare_intent summary. `tool` stays unknown:
// the hook's `agent` field is ignored server-side on purpose (CONTRACT.md), so nothing
// records which CLI an agent is. `color` is the teammate's own token color; left out when
// the name is unknown, so the browser falls back to its palette instead of painting gray.
const agent = (name: string, task?: string) => ({ id: name, name, owner: name, color: COLORS[name], task })

// One `events` row -> dashboard messages (see the contract in src/store.ts).
export function translate(db: DatabaseSync, r: Row): Msg[] {
  const p = JSON.parse(r.payload)
  const agentId = r.agent
  switch (r.type) {
    case 'declare_intent':
      return p.files.map((path: string) => ({ type: 'claim.add', data: { agentId, path, intent: p.summary } }))
    case 'edit':
      return [{ type: 'file.touch', data: { agentId, path: p.file } }]
    case 'propose_spec_change': {
      const spec = db.prepare('SELECT owner, consumers, shape FROM spec WHERE contract = ?').get(p.entry) as any
      // `affects`: whoever has claimed one of the contract's consumer files -- the same
      // claims lookup backend/coordinator.py uses to name the teammates an alert affects.
      const consumers: string[] = spec ? JSON.parse(spec.consumers) : []
      const affects = consumers.length
        ? (db.prepare(`SELECT DISTINCT agent FROM claims WHERE file IN (${consumers.map(() => '?').join(',')}) AND agent != ?`).all(...consumers, agentId) as any[]).map((c) => c.agent)
        : []
      return [{
        type: 'proposal.add',
        data: { id: String(r.id), agentId, title: p.entry, target: spec?.owner ?? NP, rationale: p.reason, before: spec?.shape ?? '', after: p.change, affects },
      }]
    }
    case 'proposal_decision':
      // A human's Accept/Reject (backend/mcp.py /api/proposals/{id}). On accept the spec's
      // shape now equals the proposal, so `before` is restored from the recorded previous
      // shape to keep the diff meaningful.
      return [{
        type: 'proposal.update',
        data: { id: String(p.proposal_id), status: p.status, by: agentId, title: p.entry, ...(p.previous_shape != null && { before: p.previous_shape }) },
      }]
    case 'alert':
      // raise_alert and escalate_to_human both log type="alert", but with different payload
      // shapes (summary/affected/suggested_fix vs. question/escalated) -- without this branch,
      // an escalation's `affected`/`summary`/`suggested_fix` are all undefined and it renders
      // as a blank card. See issue #13. The backend detects one conflict type (contract
      // drift, SPEC.md) and has no severity scale, so `severity` is left unset.
      return [{
        type: 'alert.add',
        data: p.escalated
          ? { id: String(r.id), type: 'escalation', agents: [], files: [], message: p.question }
          : { id: String(r.id), type: 'drift', agents: p.affected ?? [], files: [], message: p.summary, suggestion: p.suggested_fix },
      }]
    case 'alert_resolved':
      return [{ type: 'alert.resolve', data: { id: String(p.alert_id), by: agentId } }]
    default: // check_conflicts, get_spec, checked_clean: feed only
      return [{ type: r.type, data: { agentId, ...p } }]
  }
}

export function snapshot(db: DatabaseSync, rows: Row[]) {
  const specs = db.prepare('SELECT owner, consumers FROM spec').all() as any[]
  // Oldest first, so the Map below ends up holding each agent's most recent intent.
  const claims = db.prepare('SELECT agent, file, summary FROM claims ORDER BY claimed_at, rowid').all() as any[]
  // Files the spec knows about; a consumer depends on its contract's owner.
  const files = new Map<string, Set<string>>()
  const file = (path: string) => files.get(path) ?? files.set(path, new Set()).get(path)!
  for (const s of specs) {
    file(s.owner)
    for (const c of JSON.parse(s.consumers)) file(c).add(s.owner)
  }
  claims.forEach((c) => file(c.file))

  const msgs = rows.flatMap((r) => translate(db, r).map((m) => ({ ...m, r })))
  // Decisions are later rows than the proposals/alerts they refer to; fold them in so a
  // freshly opened tab shows the same statuses a live one reached incrementally.
  const decisions = new Map(msgs.filter((m) => m.type === 'proposal.update').map((m) => [m.data.id, m.data]))
  const resolved = new Set(msgs.filter((m) => m.type === 'alert.resolve').map((m) => m.data.id))
  const tasks = new Map(claims.map((c) => [c.agent, c.summary]))
  const ts = (m: { r: Row }) => Date.parse(m.r.ts + 'Z')
  return {
    agents: [...new Set([...claims.map((c) => c.agent), ...rows.map((r) => r.agent)])].filter((a) => !HIDDEN_AGENTS.has(a)).map((a) => agent(a, tasks.get(a))),
    files: [...files].map(([path, deps]) => ({ path, deps: [...deps] })),
    claims: claims.map((c) => ({ agentId: c.agent, path: c.file, intent: c.summary })),
    proposals: msgs
      .filter((m) => m.type === 'proposal.add')
      .map((m) => {
        const d = decisions.get(m.data.id)
        return { ...m.data, ...(d && { status: d.status, ...(d.before != null && { before: d.before }) }), ts: ts(m) }
      })
      .reverse(),
    alerts: msgs.filter((m) => m.type === 'alert.add').map((m) => ({ ...m.data, status: resolved.has(m.data.id) ? 'resolved' : 'open', ts: ts(m) })).reverse(),
    events: msgs.slice(-300).reverse().map((m, i) => ({ id: `${m.r.id}-${i}`, type: m.type, data: m.data, ts: ts(m) })),
  }
}

// Returns the /api/stream handler. Vite passes TEAM_TOKENS from .env; standalone reads process.env.
export function createStream(teamTokens = process.env.TEAM_TOKENS) {
  COLORS = parseColors(teamTokens)
  return stream
}

function stream(req: IncomingMessage, res: ServerResponse) {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
  } catch (e) {
    return res.writeHead(503).end(`Cannot open ${DB_PATH}: ${e}`) // EventSource retries
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const send = (m: Msg) => res.write(`data: ${JSON.stringify(m)}\n\n`)

  const rows = db.prepare('SELECT * FROM events ORDER BY id').all() as Row[]
  const snap = snapshot(db, rows)
  send({ type: 'snapshot', data: snap })
  let lastId = rows.at(-1)?.id ?? 0
  const seenAgents = new Set(snap.agents.map((a) => a.id))
  const seenFiles = new Set(snap.files.map((f) => f.path))

  // ponytail: one poll loop per open tab, share one loop if many dashboards connect
  const timer = setInterval(() => {
    for (const r of db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id').all(lastId) as Row[]) {
      if (!HIDDEN_AGENTS.has(r.agent) && !seenAgents.has(r.agent)) seenAgents.add(r.agent), send({ type: 'agent.upsert', data: agent(r.agent) })
      for (const m of translate(db, r)) {
        const path = m.type === 'claim.add' || m.type === 'file.touch' ? m.data.path : null
        if (path && !seenFiles.has(path)) seenFiles.add(path), send({ type: 'file.add', data: { path } })
        send(m)
      }
      lastId = r.id
    }
  }, 500)
  req.on('close', () => {
    clearInterval(timer)
    db.close()
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handler = createStream()
  createServer((req, res) => (req.url === '/api/stream' ? handler(req, res) : res.writeHead(404).end()))
    .listen(PORT, () => console.log(`dashboard server on :${PORT}, reading ${DB_PATH}`))
}
