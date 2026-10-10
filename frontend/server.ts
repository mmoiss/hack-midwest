// Dashboard server: reads the coordinator's SQLite file (read-only) and pushes
// it to the browser over Server-Sent Events, per SPEC.md. Python is the only writer.
//   GET /api/stream  ->  `snapshot` first, then one message per new `events` row.
// In dev, vite.config.ts mounts `stream` directly; `npm run server` runs it standalone.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../backend/coordinator.db', import.meta.url))
const PORT = Number(process.env.PORT ?? 3001)
const NP = '[NOT PROVISIONED]'

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
const agent = (name: string) => ({ id: name, name, owner: name, color: COLORS[name] ?? '#a1a1aa', tool: NP, status: NP, task: NP })

// One `events` row -> dashboard messages (see the contract in src/store.ts).
function translate(db: DatabaseSync, r: Row): Msg[] {
  const p = JSON.parse(r.payload)
  const agentId = r.agent
  switch (r.type) {
    case 'declare_intent':
      return p.files.map((path: string) => ({ type: 'claim.add', data: { agentId, path, intent: p.summary } }))
    case 'edit':
      return [{ type: 'file.touch', data: { agentId, path: p.file } }]
    case 'propose_spec_change': {
      const spec = db.prepare('SELECT owner, shape FROM spec WHERE contract = ?').get(p.entry) as any
      return [{
        type: 'proposal.add',
        data: { id: String(r.id), agentId, title: p.entry, target: spec?.owner ?? NP, rationale: p.reason, before: spec?.shape ?? '', after: p.change, affects: [] },
      }]
    }
    case 'alert':
      return [{
        type: 'alert.add',
        data: { id: String(r.id), type: NP, severity: NP, agents: p.affected ?? [], files: [], message: p.summary, suggestion: p.suggested_fix },
      }]
    default: // check_conflicts, get_spec, checked_clean: feed only
      return [{ type: r.type, data: { agentId, ...p } }]
  }
}

function snapshot(db: DatabaseSync, rows: Row[]) {
  const specs = db.prepare('SELECT owner, consumers FROM spec').all() as any[]
  const claims = db.prepare('SELECT agent, file, summary FROM claims').all() as any[]
  // Files the spec knows about; a consumer depends on its contract's owner.
  const files = new Map<string, Set<string>>()
  const file = (path: string) => files.get(path) ?? files.set(path, new Set()).get(path)!
  for (const s of specs) {
    file(s.owner)
    for (const c of JSON.parse(s.consumers)) file(c).add(s.owner)
  }
  claims.forEach((c) => file(c.file))

  const msgs = rows.flatMap((r) => translate(db, r).map((m) => ({ ...m, r })))
  return {
    agents: [...new Set([...claims.map((c) => c.agent), ...rows.map((r) => r.agent)])].map(agent),
    files: [...files].map(([path, deps]) => ({ path, deps: [...deps] })),
    claims: claims.map((c) => ({ agentId: c.agent, path: c.file, intent: c.summary })),
    proposals: msgs.filter((m) => m.type === 'proposal.add').map((m) => ({ ...m.data, ts: Date.parse(m.r.ts + 'Z') })).reverse(),
    alerts: msgs.filter((m) => m.type === 'alert.add').map((m) => ({ ...m.data, ts: Date.parse(m.r.ts + 'Z') })).reverse(),
    events: msgs.slice(-300).reverse().map((m, i) => ({ id: `${m.r.id}-${i}`, type: m.type, data: m.data, ts: Date.parse(m.r.ts + 'Z') })),
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
      if (!seenAgents.has(r.agent)) seenAgents.add(r.agent), send({ type: 'agent.upsert', data: agent(r.agent) })
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
