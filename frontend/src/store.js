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

const initial = {
  agents: {},
  files: [],
  claims: [],
  proposals: [],
  alerts: [],
  events: [],
}

// Fill defaults so a half-built backend message can't white-screen the UI.
const fix = {
  file: (f) => ({ deps: [], ...f }),
  proposal: (p) => ({ status: 'pending', affects: [], before: '', after: '', ...p }),
  alert: (a) => ({ status: 'open', severity: 'med', agents: [], files: [], message: '', ...a }),
}

function reduce(s, { type, data = {}, ts = Date.now() }) {
  if (type === 'snapshot') {
    return {
      ...s,
      agents: Object.fromEntries((data.agents ?? []).map((a) => [a.id, a])),
      files: (data.files ?? []).map(fix.file),
      claims: data.claims ?? [],
      proposals: (data.proposals ?? []).map(fix.proposal),
      alerts: (data.alerts ?? []).map(fix.alert),
      events: data.events ?? [],
    }
  }
  const events = [{ id: `${ts}-${Math.random()}`, type, data, ts }, ...s.events].slice(0, 300)
  const next = { ...s, events }
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
export const agentColor = (agents, id) => PALETTE[Object.keys(agents).indexOf(id) % PALETTE.length] ?? '#b3b0a8'

const savedTheme = () => {
  try { return localStorage.getItem('theme') } catch { return null }
}

export const useStore = create((set) => ({
  ...initial,
  theme: savedTheme() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('theme', theme) } catch {}
      return { theme }
    }),
  connection: 'connecting',
  tab: 'changes',
  selectedProposal: null,
  selectedFile: null,
  hoveredAgent: null,
  lastAlert: null,

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
export const openAlerts = (s) => s.alerts.filter((a) => a.status === 'open')
export const pendingProposals = (s) => s.proposals.filter((p) => p.status === 'pending')
