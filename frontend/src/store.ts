import { create } from 'zustand'

/*
 * Event contract (server.ts -> dashboard over SSE). Every message is
 *   { type, data, ts }
 *
 * snapshot         { agents[], files[], claims[], proposals[], alerts[], events[] }
 * agent.upsert     { id, name, owner, tool, color, status, task, currentFile }
 * file.add         { path, deps?[] }
 * file.touch       { agentId, path }
 * claim.add        { agentId, path, intent }
 * claim.release    { agentId, path }
 * proposal.add     { id, agentId, title, target, rationale, before, after, status, affects[] }
 * proposal.update  { id, status, by?, before? }        // pending | accepted | rejected
 * alert.add        { id, type, severity?, agents[], files[], message, suggestion }
 * alert.resolve    { id, by? }
 *
 * Human decisions (dashboard -> Python server, the only SQLite writer; see backend/mcp.py):
 *   POST /api/proposals/{id}        { status: accepted | rejected }
 *   POST /api/alerts/{id}/resolve
 * The server logs each as an event, and the feed above carries the resulting
 * proposal.update / alert.resolve to every open dashboard.
 */

export type AgentStatus = 'editing' | 'idle' | 'blocked' | string
export type Agent = { id: string; name: string; owner?: string; tool?: string; color?: string; status?: AgentStatus; task?: string; currentFile?: string }
export type FileEntry = { path: string; deps: string[] }
export type Claim = { agentId: string; path: string; intent: string }
export type ProposalStatus = 'pending' | 'accepted' | 'rejected'
export type Proposal = {
  id: string; agentId: string; title: string; target: string; rationale?: string
  before: string; after: string; status: ProposalStatus; affects: string[]; ts?: number
}
export type AlertType = 'collision' | 'drift' | 'escalation' | string
export type Alert = {
  id: string; type: AlertType; severity?: string; agents: string[]; files: string[]
  message: string; suggestion?: string; status: 'open' | 'resolved'; ts: number
}
export type FeedEvent = { id: string; type: string; data: any; ts: number }
export type Msg = { type: string; data?: any; ts?: number }
export type Theme = 'light' | 'dark'
export type Connection = 'connecting' | 'live' | 'offline'
export type Page = 'overview' | 'agent' | 'changes' | 'alerts' | 'feed' | 'map'

type Data = {
  agents: Record<string, Agent>
  files: FileEntry[]
  claims: Claim[]
  proposals: Proposal[]
  alerts: Alert[]
  events: FeedEvent[]
  lastAlert: Alert | null
  lastProposal: Proposal | null   // newest live proposal; the banner flashes it as "needs your decision"
}

export type State = Data & {
  theme: Theme
  project: string
  projects: string[]
  setProject: (p: string) => void
  connection: Connection
  page: Page
  selectedAgent: string | null
  selectedProposal: string | null
  selectedFile: string | null
  hoveredAgent: string | null
  pending: Record<string, true>   // proposal/alert ids with a decision in flight
  notice: string | null           // last failed decision, shown briefly by App
  toggleTheme: () => void
  apply: (msg: Msg) => void
  setConnection: (c: Connection) => void
  setPage: (p: Page) => void
  openAgent: (id: string) => void
  selectProposal: (id: string) => void
  openProposal: (id: string) => void
  selectFile: (path: string | null) => void
  hoverAgent: (id: string | null) => void
  decideProposal: (id: string, status: ProposalStatus) => void
  resolveAlert: (id: string) => void
  dismissNotice: () => void
}

const initial: Data = {
  agents: {},
  files: [],
  claims: [],
  proposals: [],
  alerts: [],
  events: [],
  lastAlert: null,
  lastProposal: null,
}

// Fill defaults so a half-built backend message can't white-screen the UI.
const fix = {
  file: (f: any): FileEntry => ({ deps: [], ...f }),
  proposal: (p: any): Proposal => ({ status: 'pending', affects: [], before: '', after: '', ...p }),
  alert: (a: any): Alert => ({ status: 'open', agents: [], files: [], message: '', ...a }),
}

function reduce(s: State, { type, data = {}, ts = Date.now() }: Msg): Partial<State> {
  if (type === 'snapshot') {
    const current: Record<string, string> = {}
    for (const e of (data.events ?? []) as FeedEvent[]) {
      if (e.type === 'file.touch' && !(e.data.agentId in current)) current[e.data.agentId] = e.data.path
    }
    return {
      agents: Object.fromEntries(((data.agents ?? []) as Agent[]).map((a) => [a.id, { currentFile: current[a.id], ...a }])),
      files: (data.files ?? []).map(fix.file),
      claims: data.claims ?? [],
      proposals: (data.proposals ?? []).map(fix.proposal),
      alerts: (data.alerts ?? []).map(fix.alert),
      events: data.events ?? [],
    }
  }
  const events = [{ id: `${ts}-${Math.random()}`, type, data, ts }, ...s.events].slice(0, 300)
  const next: Partial<State> = { events }
  switch (type) {
    case 'agent.upsert':
      next.agents = { ...s.agents, [data.id]: { ...s.agents[data.id], ...data } }
      break
    case 'file.add':
      if (!s.files.some((f) => f.path === data.path)) next.files = [...s.files, fix.file(data)]
      break
    case 'file.touch':
      next.agents = { ...s.agents, [data.agentId]: { ...s.agents[data.agentId], currentFile: data.path } }
      break
    case 'claim.add':
      next.claims = [...s.claims.filter((c) => !(c.agentId === data.agentId && c.path === data.path)), data]
      // An agent's "task" is its latest declared intent (same as server.ts's snapshot).
      if (data.agentId in s.agents) next.agents = { ...s.agents, [data.agentId]: { ...s.agents[data.agentId], task: data.intent } }
      break
    case 'claim.release':
      next.claims = s.claims.filter((c) => !(c.agentId === data.agentId && c.path === data.path))
      break
    case 'proposal.add':
      next.proposals = [{ ...fix.proposal(data), ts }, ...s.proposals]
      next.lastProposal = { ...fix.proposal(data), ts }
      break
    case 'proposal.update':
      next.proposals = s.proposals.map((p) => (p.id === data.id ? { ...p, status: data.status, ...(data.before != null && { before: data.before }) } : p))
      break
    case 'alert.add':
      next.alerts = [{ ...fix.alert(data), ts }, ...s.alerts]
      next.lastAlert = { ...fix.alert(data), ts }
      break
    case 'alert.resolve':
      next.alerts = s.alerts.map((a) => (a.id === data.id ? { ...a, status: 'resolved' } : a))
      break
  }
  return next
}

// Each teammate's color is the one their token was issued with (scripts/make_tokens.py ->
// TEAM_TOKENS -> server.ts), so the dashboard matches /api/whoami and the demo launcher.
// The palette below is only the fallback, assigned by registration order, for an agent the
// token table doesn't know (e.g. a local run with TEAM_TOKENS unset).
export const PALETTE = ['#c8794a', '#7a9a6e', '#6a86a3', '#b0655c', '#8f8a5a', '#9a7b5a']
export const agentColor = (agents: Record<string, Agent>, id: string): string =>
  agents[id]?.color ?? PALETTE[Object.keys(agents).indexOf(id) % PALETTE.length] ?? '#b3b0a8'

// Human-readable alert kinds. The backend raises `drift` (raise_alert) and `escalation`
// (escalate_to_human); `collision` is reserved for the same-file conflict SPEC.md cut.
export const ALERT_LABEL: Record<string, string> = { collision: 'Collision', drift: 'Contract drift', escalation: 'Human decision' }
export const alertLabel = (type: string) => ALERT_LABEL[type] ?? 'Alert'

const savedTheme = (): Theme | null => {
  try { return localStorage.getItem('theme') as Theme | null } catch { return null }
}

// Same origin by default: the Vite dev server proxies /api/proposals and /api/alerts to the
// Python server, and Caddy routes /api/* to it in production. Override only if the Python
// server lives somewhere else (then it needs CORS, which it does not do today).
const API_URL: string = (import.meta as any).env?.VITE_API_URL ?? ''

type Setter = (partial: Partial<State> | ((s: State) => Partial<State>)) => void

// A human decision: POST it to the Python server (the only SQLite writer), which logs it as
// an event. The SSE feed then carries the resulting proposal.update / alert.resolve to every
// open dashboard within a poll tick; `patch` is applied locally first only to hide that
// ~500ms, and is idempotent with the message that follows.
async function decide(set: Setter, key: string, url: string, body: object, patch: (s: State) => Partial<State>) {
  set((s) => ({ pending: { ...s.pending, [key]: true } }))
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? `${res.status} ${res.statusText}`)
    }
    set(patch)
  } catch (e) {
    set({ notice: `Couldn't save that: ${(e as Error).message}` })
  } finally {
    set((s) => { const { [key]: _, ...pending } = s.pending; return { pending } })
  }
}

export const useStore = create<State>()((set) => ({
  ...initial,
  theme: savedTheme() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('theme', theme) } catch {}
      return { theme }
    }),
  // ponytail: projects are a stub until the backend knows about more than one repo.
  project: 'mmoiss/hack-midwest',
  projects: ['mmoiss/hack-midwest'],
  setProject: (project) => set({ project }),
  connection: 'connecting',
  page: 'overview',
  selectedAgent: null,
  selectedProposal: null,
  selectedFile: null,
  hoveredAgent: null,
  pending: {},
  notice: null,

  apply: (msg) => set((s) => reduce(s, msg)),
  setConnection: (connection) => set({ connection }),
  setPage: (page) => set({ page }),
  openAgent: (selectedAgent) => set({ page: 'agent', selectedAgent }),
  selectProposal: (id) => set((s) => ({ selectedProposal: s.selectedProposal === id ? null : id })),
  openProposal: (selectedProposal) => set({ page: 'changes', selectedProposal }),
  selectFile: (path) => set({ selectedFile: path }),
  hoverAgent: (id) => set({ hoveredAgent: id }),

  decideProposal: (id, status) =>
    decide(set, id, `${API_URL}/api/proposals/${encodeURIComponent(id)}`, { status }, (s) => ({
      proposals: s.proposals.map((p) => (p.id === id ? { ...p, status } : p)),
    })),
  resolveAlert: (id) =>
    decide(set, id, `${API_URL}/api/alerts/${encodeURIComponent(id)}/resolve`, {}, (s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: 'resolved' } : a)),
    })),
  dismissNotice: () => set({ notice: null }),
}))

// Derived helpers
export const openAlerts = (s: Pick<State, 'alerts'>) => s.alerts.filter((a) => a.status === 'open')
export const pendingProposals = (s: Pick<State, 'proposals'>) => s.proposals.filter((p) => p.status === 'pending')

export function alertTargets(s: Pick<State, 'agents' | 'files' | 'claims'>, a: Alert) {
  const named = [...a.agents, ...a.files]
  const agents = new Set(named.filter((x) => x in s.agents))
  const files = new Set(named.filter((x) => s.files.some((f) => f.path === x)))
  for (const c of s.claims) {
    if (agents.has(c.agentId)) files.add(c.path)
    else if (files.has(c.path)) agents.add(c.agentId)
  }
  return { agents: [...agents], files: [...files] }
}

// The backend records facts (claims, edits, alerts), not a status, so status is derived here
// the same way Ship.tsx poses the crew: named by an open alert -> blocked; has touched a
// file -> editing; otherwise idle.
export function agentStatus(s: Pick<State, 'agents' | 'files' | 'claims' | 'alerts'>, id: string): AgentStatus {
  if (openAlerts(s).some((a) => alertTargets(s, a).agents.includes(id))) return 'blocked'
  return s.agents[id]?.currentFile ? 'editing' : 'idle'
}
