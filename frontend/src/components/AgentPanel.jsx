import { useStore } from '../store'

const STATUS = {
  editing: 'text-emerald-400',
  idle: 'text-zinc-500',
  blocked: 'text-red-400',
}

export default function AgentPanel() {
  const { agents, claims, hoverAgent, hoveredAgent, selectedFile, alerts } = useStore()
  const fileAlerts = selectedFile ? alerts.filter((a) => a.status === 'open' && a.files.includes(selectedFile)) : []

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      <h2 className="px-4 pt-3 pb-2 text-xs font-semibold uppercase text-zinc-500">Agents</h2>
      <ul className="space-y-1 px-2">
        {Object.values(agents).map((a) => {
          const mine = claims.filter((c) => c.agentId === a.id)
          return (
            <li
              key={a.id}
              onMouseEnter={() => hoverAgent(a.id)}
              onMouseLeave={() => hoverAgent(null)}
              className={`cursor-default rounded-md border-l-4 px-3 py-2 ${hoveredAgent === a.id ? 'bg-zinc-800' : ''}`}
              style={{ borderColor: a.color }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium" style={{ color: a.color }}>{a.name}</span>
                <span className={`text-xs ${STATUS[a.status] ?? 'text-zinc-400'}`}>● {a.status}</span>
              </div>
              <div className="text-xs text-zinc-500">{a.tool}</div>
              <div className="mt-1 text-xs text-zinc-300">{a.task}</div>
              {a.currentFile && <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">✎ {a.currentFile}</div>}
              {mine.length > 0 && <div className="mt-1 text-[11px] text-zinc-500">{mine.length} claim{mine.length > 1 && 's'}</div>}
            </li>
          )
        })}
      </ul>

      {selectedFile && (
        <div className="mt-auto border-t border-zinc-800 p-4 text-xs">
          <div className="mb-2 font-mono text-zinc-300 break-all">{selectedFile}</div>
          {claims.filter((c) => c.path === selectedFile).map((c) => (
            <div key={c.agentId} className="mb-1">
              <span style={{ color: agents[c.agentId]?.color }}>{agents[c.agentId]?.name}</span>
              <span className="text-zinc-500"> — {c.intent}</span>
            </div>
          ))}
          {fileAlerts.map((a) => (
            <div key={a.id} className="mt-1 text-red-400">⚠ {a.type}</div>
          ))}
          {!claims.some((c) => c.path === selectedFile) && !fileAlerts.length && <div className="text-zinc-500">Unclaimed</div>}
        </div>
      )}
    </aside>
  )
}
