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
 * proposal.update  { id, status }                     // pending | accepted | rejected
 * alert.add        { id, type, severity, agents[], files[], message, suggestion }
 * alert.resolve    { id }
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
export type AlertType = 'collision' | 'drift' | string
export type Alert = {
  id: string; type: AlertType; severity: string; agents: string[]; files: string[]
  message: string; suggestion?: string; status: 'open' | 'resolved'; ts: number
}
export type FeedEvent = { id: string; type: string; data: any; ts: number }
export type Msg = { type: string; data?: any; ts?: number }
export type Theme = 'light' | 'dark'
export type Connection = 'connecting' | 'live' | 'offline'
export type Tab = 'changes' | 'alerts' | 'feed'

type Data = {
  agents: Record<string, Agent>
  files: FileEntry[]
  claims: Claim[]
  proposals: Proposal[]
  alerts: Alert[]
  events: FeedEvent[]
  lastAlert: Alert | null
}

export type State = Data & {
  theme: Theme
  connection: Connection
  tab: Tab
  selectedProposal: string | null
  selectedFile: string | null
  hoveredAgent: string | null
  toggleTheme: () => void
  apply: (msg: Msg) => void
  setConnection: (c: Connection) => void
  setTab: (t: Tab) => void
  selectProposal: (id: string) => void
  selectFile: (path: string | null) => void
  hoverAgent: (id: string | null) => void
  decideProposal: (id: string, status: ProposalStatus) => void
  resolveAlert: (id: string) => void
}

const initial: Data = {
  agents: {},
  files: [],
  claims: [],
  proposals: [],
  alerts: [],
  events: [],
  lastAlert: null,
}

// Fill defaults so a half-built backend message can't white-screen the UI.
const fix = {
  file: (f: any): FileEntry => ({ deps: [], ...f }),
  proposal: (p: any): Proposal => ({ status: 'pending', affects: [], before: '', after: '', ...p }),
  alert: (a: any): Alert => ({ status: 'open', severity: 'med', agents: [], files: [], message: '', ...a }),
}

function reduce(s: State, { type, data = {}, ts = Date.now() }: Msg): Partial<State> {
  if (type === 'snapshot') {
    return {
      agents: Object.fromEntries(((data.agents ?? []) as Agent[]).map((a) => [a.id, a])),
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
      break
    case 'claim.release':
      next.claims = s.claims.filter((c) => !(c.agentId === data.agentId && c.path === data.path))
      break
    case 'proposal.add':
      next.proposals = [{ ...fix.proposal(data), ts }, ...s.proposals]
      break
    case 'proposal.update':
      next.proposals = s.proposals.map((p) => (p.id === data.id ? { ...p, ...data } : p))
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

// Agents get a color from this palette in registration order; the backend's color is ignored
// so the UI stays on one warm, tame scheme.
export const PALETTE = ['#c8794a', '#7a9a6e', '#6a86a3', '#b0655c', '#8f8a5a', '#9a7b5a']
export const agentColor = (agents: Record<string, Agent>, id: string): string =>
  PALETTE[Object.keys(agents).indexOf(id) % PALETTE.length] ?? '#b3b0a8'

const savedTheme = (): Theme | null => {
  try { return localStorage.getItem('theme') as Theme | null } catch { return null }
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
  connection: 'connecting',
  tab: 'changes',
  selectedProposal: null,
  selectedFile: null,
  hoveredAgent: null,

  apply: (msg) => set((s) => reduce(s, msg)),
  setConnection: (connection) => set({ connection }),
  setTab: (tab) => set({ tab }),
  selectProposal: (id) => set((s) => ({ selectedProposal: s.selectedProposal === id ? null : id })),
  selectFile: (path) => set({ selectedFile: path }),
  hoverAgent: (id) => set({ hoveredAgent: id }),

  // ponytail: not wired yet. Needs a Python route (the only SQLite writer) that logs the decision as an event.
  decideProposal: (id, status) => console.warn('decideProposal not provisioned', id, status),
  resolveAlert: (id) => console.warn('resolveAlert not provisioned', id),
}))

// Derived helpers
export const openAlerts = (s: State) => s.alerts.filter((a) => a.status === 'open')
export const pendingProposals = (s: State) => s.proposals.filter((p) => p.status === 'pending')
