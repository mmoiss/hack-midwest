import { useStore, agentColor } from '../store'

const STATUS = {
  editing: 'bg-ok-soft text-ok',
  blocked: 'bg-danger-soft text-danger',
}

export default function AgentPanel() {
  const { agents, claims, hoverAgent, hoveredAgent, selectedFile, alerts } = useStore()
  const fileAlerts = selectedFile ? alerts.filter((a) => a.status === 'open' && a.files.includes(selectedFile)) : []

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden">
      <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Agents</h2>
      <ul className="divide-y divide-line overflow-y-auto border-b border-line">
        {Object.values(agents).map((a) => {
          const mine = claims.filter((c) => c.agentId === a.id).length
          return (
            <li
              key={a.id}
              onMouseEnter={() => hoverAgent(a.id)}
              onMouseLeave={() => hoverAgent(null)}
              className={`cursor-default px-5 py-3 transition-colors ${hoveredAgent === a.id ? 'bg-surface' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: agentColor(agents, a.id) }} />
                <span className="text-sm font-medium">{a.name}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[a.status] ?? 'bg-surface text-muted'}`}>{a.status}</span>
              </div>
              {a.task && <div className="mt-1 pl-4.5 text-xs text-muted">{a.task}</div>}
              {a.currentFile && <div className="mt-1 truncate pl-4.5 font-mono text-[11px] text-faint">{a.currentFile}</div>}
              {mine > 0 && <div className="mt-1 pl-4.5 text-[11px] text-faint">{mine} claim{mine > 1 && 's'}</div>}
            </li>
          )
        })}
      </ul>

      {selectedFile && (
        <div className="mt-auto border-t border-line p-4 text-xs">
          <div className="mb-2 font-mono break-all">{selectedFile}</div>
          {claims.filter((c) => c.path === selectedFile).map((c) => (
            <div key={c.agentId} className="mb-1">
              <span className="font-medium">{agents[c.agentId]?.name}</span>
              <span className="text-muted">: {c.intent}</span>
            </div>
          ))}
          {fileAlerts.map((a) => (
            <div key={a.id} className="mt-1 text-danger">{a.type}</div>
          ))}
          {!claims.some((c) => c.path === selectedFile) && !fileAlerts.length && <div className="text-faint">Unclaimed</div>}
        </div>
      )}
    </aside>
  )
}
