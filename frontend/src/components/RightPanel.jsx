import { diffLines } from 'diff'
import { useStore, openAlerts, pendingProposals } from '../store'

export default function RightPanel() {
  const s = useStore()
  const tabs = [
    ['changes', 'Proposed changes', pendingProposals(s).length, 'bg-cyan-500'],
    ['alerts', 'Alerts', openAlerts(s).length, 'bg-red-500'],
    ['feed', 'Feed', 0],
  ]
  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
      <nav className="flex border-b border-zinc-800 text-sm">
        {tabs.map(([id, label, n, badge]) => (
          <button
            key={id}
            onClick={() => s.setTab(id)}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 ${s.tab === id ? 'border-b-2 border-cyan-400 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            {label}
            {n > 0 && <span className={`rounded-full px-1.5 text-xs font-bold text-zinc-950 ${badge}`}>{n}</span>}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {s.tab === 'changes' && <Changes />}
        {s.tab === 'alerts' && <Alerts />}
        {s.tab === 'feed' && <Feed />}
      </div>
    </aside>
  )
}

const STATUS_PILL = {
  pending: 'bg-cyan-500/15 text-cyan-300',
  accepted: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-zinc-500/15 text-zinc-400 line-through',
}

function Changes() {
  const { proposals, agents, selectedProposal, selectProposal, decideProposal } = useStore()
  if (!proposals.length) return <Empty>No proposed changes yet.</Empty>
  return (
    <ul className="space-y-2">
      {proposals.map((p) => {
        const a = agents[p.agentId]
        const open = selectedProposal === p.id
        return (
          <li key={p.id} className="rounded-md border border-zinc-800 bg-zinc-950">
            <button onClick={() => selectProposal(p.id)} className="w-full p-3 text-left">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: a?.color }} />
                <span className="text-xs" style={{ color: a?.color }}>{a?.name}</span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_PILL[p.status]}`}>{p.status}</span>
              </div>
              <div className="mt-1 text-sm">{p.title}</div>
              <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{p.target}</div>
            </button>
            {open && (
              <div className="border-t border-zinc-800 p-3">
                {p.rationale && <p className="mb-2 text-xs text-zinc-400">{p.rationale}</p>}
                {p.affects?.length > 0 && (
                  <p className="mb-2 text-xs text-amber-400">
                    Affects: {p.affects.map((id) => agents[id]?.name ?? id).join(', ')}
                  </p>
                )}
                <Diff before={p.before} after={p.after} />
                {p.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => decideProposal(p.id, 'accepted')} className="flex-1 rounded bg-emerald-600 py-1.5 text-sm font-medium hover:bg-emerald-500">Accept</button>
                    <button onClick={() => decideProposal(p.id, 'rejected')} className="flex-1 rounded bg-zinc-700 py-1.5 text-sm font-medium hover:bg-zinc-600">Reject</button>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Diff({ before = '', after = '' }) {
  const parts = diffLines(before, after)
  return (
    <pre className="overflow-x-auto rounded bg-zinc-900 py-2 font-mono text-[11px] leading-5">
      {parts.flatMap((part, i) =>
        part.value.replace(/\n$/, '').split('\n').map((line, j) => (
          <div
            key={`${i}-${j}`}
            className={`px-2 ${part.added ? 'bg-emerald-500/15 text-emerald-300' : part.removed ? 'bg-red-500/15 text-red-300' : 'text-zinc-400'}`}
          >
            {part.added ? '+ ' : part.removed ? '- ' : '  '}
            {line}
          </div>
        )),
      )}
    </pre>
  )
}

function Alerts() {
  const { alerts, agents, resolveAlert, selectFile } = useStore()
  if (!alerts.length) return <Empty>No collisions or drift. All agents in sync.</Empty>
  const sorted = [...alerts].sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1))
  return (
    <ul className="space-y-2">
      {sorted.map((al) => {
        const red = al.type === 'collision'
        const done = al.status === 'resolved'
        return (
          <li
            key={al.id}
            className={`rounded-md border p-3 ${done ? 'border-zinc-800 opacity-50' : red ? 'border-red-500/60 bg-red-950/30' : 'border-amber-400/60 bg-amber-950/30'}`}
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase">
              <span className={done ? 'text-zinc-400' : red ? 'text-red-400' : 'text-amber-400'}>
                {done ? '✓' : '⚠'} {red ? 'Collision' : 'Context drift'}
              </span>
              <span className="text-zinc-500">· {al.severity}</span>
              <span className="ml-auto font-normal normal-case text-zinc-500">{new Date(al.ts).toLocaleTimeString()}</span>
            </div>
            <p className="mt-1.5 text-sm">{al.message}</p>
            {al.suggestion && <p className="mt-1 text-xs text-zinc-400">→ {al.suggestion}</p>}
            <div className="mt-2 flex flex-wrap gap-1">
              {al.agents.map((id) => (
                <span key={id} className="rounded px-1.5 text-[11px]" style={{ color: agents[id]?.color, background: (agents[id]?.color ?? '#888') + '22' }}>
                  {agents[id]?.name ?? id}
                </span>
              ))}
              {al.files.map((f) => (
                <button key={f} onClick={() => selectFile(f)} className="rounded bg-zinc-800 px-1.5 font-mono text-[11px] text-zinc-400 hover:text-zinc-200">
                  {f.split('/').pop()}
                </button>
              ))}
            </div>
            {!done && (
              <button onClick={() => resolveAlert(al.id)} className="mt-2 text-xs text-zinc-400 underline hover:text-zinc-200">
                Mark resolved
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function describe(e, agents) {
  const name = (id) => agents[id]?.name ?? id
  const d = e.data
  switch (e.type) {
    case 'agent.upsert': return [d.id, `${name(d.id)} → ${d.status ?? 'updated'}`]
    case 'file.touch': return [d.agentId, `${name(d.agentId)} editing ${d.path}`]
    case 'claim.add': return [d.agentId, `${name(d.agentId)} claimed ${d.path}`]
    case 'claim.release': return [d.agentId, `${name(d.agentId)} released ${d.path}`]
    case 'proposal.add': return [d.agentId, `${name(d.agentId)} proposed: ${d.title}`]
    case 'proposal.update': return [null, `Proposal ${d.id} ${d.status}`]
    case 'alert.add': return [null, `⚠ ${d.type}: ${d.message}`]
    case 'alert.resolve': return [null, `✓ Alert ${d.id} resolved`]
    case 'file.add': return [null, `New file ${d.path}`]
    default: return [null, e.type]
  }
}

function Feed() {
  const { events, agents } = useStore()
  if (!events.length) return <Empty>Waiting for events…</Empty>
  return (
    <ul className="space-y-1 font-mono text-[11px]">
      {events.map((e) => {
        const [agentId, text] = describe(e, agents)
        return (
          <li key={e.id} className={`flex gap-2 ${e.type === 'alert.add' ? 'text-red-300' : 'text-zinc-300'}`}>
            <span className="shrink-0 text-zinc-600">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: agents[agentId]?.color ?? '#52525b' }} />
            <span>{text}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Empty({ children }) {
  return <div className="py-10 text-center text-sm text-zinc-500">{children}</div>
}
