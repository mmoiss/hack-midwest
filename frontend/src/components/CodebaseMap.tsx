import { useEffect, useMemo } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Panel, Handle, Position, useNodesState, useReactFlow, type Node, type Edge, type NodeProps } from '@xyflow/react'
import { useStore, agentColor, alertTargets, type FileEntry } from '../store'

const COL = 290
const ROW = 84
const TOP = 56

type FileData = {
  base: string; dir: string; tint: string | null; border: string | null; owner: boolean; drift: boolean
  touching: { id: string; name: string; color: string }[]; dim: boolean; selected: boolean
}
type LabelData = { label: string }
type MapNode = Node<FileData, 'file'> | Node<LabelData, 'label'>

function layers(files: FileEntry[]) {
  const deps = new Map(files.map((f) => [f.path, f.deps]))
  const memo = new Map<string, number>()
  const depth = (p: string, seen = new Set<string>()): number => {
    if (memo.has(p)) return memo.get(p)!
    if (seen.has(p)) return 0
    seen.add(p)
    const d = (deps.get(p) ?? []).filter((x) => deps.has(x))
    const v = d.length ? 1 + Math.max(...d.map((x) => depth(x, seen))) : 0
    memo.set(p, v)
    return v
  }
  return new Map(files.map((f) => [f.path, depth(f.path)]))
}

function layoutColumns(files: FileEntry[]) {
  const layer = layers(files)
  const groups = new Map<string, FileEntry[]>()
  for (const f of files) {
    const top = f.path.includes('/') ? f.path.split('/')[0] : '/'
    groups.set(top, [...(groups.get(top) ?? []), f])
  }
  const cols = [...groups].sort(
    ([a, fa], [b, fb]) => Math.min(...fa.map((f) => layer.get(f.path)!)) - Math.min(...fb.map((f) => layer.get(f.path)!)) || a.localeCompare(b),
  )
  const nodes: MapNode[] = []
  cols.forEach(([top, list], c) => {
    nodes.push({ id: `label:${top}`, type: 'label', position: { x: c * COL, y: 0 }, data: { label: top }, draggable: false, selectable: false })
    list
      .sort((a, b) => layer.get(a.path)! - layer.get(b.path)! || a.path.localeCompare(b.path))
      .forEach((f, i) => {
        const parts = f.path.split('/')
        const dir = parts.slice(top === '/' ? 0 : 1, -1).join('/')
        nodes.push({
          id: f.path,
          type: 'file',
          position: { x: c * COL, y: TOP + i * ROW },
          data: { base: parts.at(-1)!, dir: dir ? `${dir}/` : '', tint: null, border: null, owner: false, drift: false, touching: [], dim: false, selected: false },
        })
      })
  })
  return nodes
}

function LabelNode({ data }: NodeProps<Node<LabelData, 'label'>>) {
  return <div className="text-[11px] font-semibold tracking-wider text-faint uppercase">{data.label}</div>
}

function FileNode({ data }: NodeProps<Node<FileData, 'file'>>) {
  const { base, dir, tint, border, owner, touching, dim, selected } = data
  return (
    <div
      className="relative w-48 rounded-lg px-2.5 py-1.5 font-mono text-xs transition-opacity"
      style={{
        background: tint ?? 'var(--canvas)',
        border: owner ? '2px solid var(--warn)' : `1px solid ${border ?? 'var(--line)'}`,
        boxShadow: selected ? '0 0 0 2px var(--faint)' : undefined,
        opacity: dim ? 0.25 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="truncate font-medium">{base}</div>
      <div className="truncate text-[11px] text-faint">{dir || ' '}</div>
      {touching.length > 0 && (
        <div className="absolute -top-2.5 -right-2.5 flex -space-x-1">
          {touching.map((a) => (
            <span
              key={a.id}
              title={`${a.name} editing`}
              className="flex h-6 w-6 items-center justify-center rounded-full font-sans text-[10px] font-semibold text-white ring-2 ring-canvas"
              style={{ background: a.color }}
            >
              {a.name[0]?.toUpperCase()}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { file: FileNode, label: LabelNode }

export default function CodebaseMap() {
  const s = useStore()
  const { files, agents, claims, alerts, hoveredAgent, selectedFile, selectFile, theme } = s
  const { fitView } = useReactFlow()
  const fileKey = files.map((f) => `${f.path}<${f.deps.join(',')}`).join('|')
  const layout = useMemo(() => layoutColumns(files), [fileKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([])

  // Re-layout only when the file set changes (keeps user drags otherwise).
  useEffect(() => {
    setNodes(layout)
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50)
  }, [layout, setNodes, fitView])

  // Live state -> node data.
  const open = alerts.filter((a) => a.status === 'open')
  const driftFiles = new Set(open.flatMap((a) => alertTargets(s, a).files))
  const dependents = new Set(files.flatMap((f) => f.deps))
  const liveNodes = nodes.map((n): MapNode => {
    if (n.type !== 'file') return n
    const cl = claims.filter((c) => c.path === n.id)
    const color = cl[0] ? agentColor(agents, cl[0].agentId) : null
    const touching = Object.values(agents)
      .filter((a) => a.currentFile === n.id)
      .map((a) => ({ id: a.id, name: a.name, color: agentColor(agents, a.id) }))
    const involved = cl.some((c) => c.agentId === hoveredAgent) || touching.some((a) => a.id === hoveredAgent)
    const drift = driftFiles.has(n.id)
    return {
      ...n,
      data: {
        ...n.data,
        tint: color && `${color}2e`,
        border: color,
        owner: drift && dependents.has(n.id),
        drift,
        touching,
        dim: !!hoveredAgent && !involved,
        selected: n.id === selectedFile,
      },
    }
  })

  const depEdges: Edge[] = files.flatMap((f) =>
    f.deps.map((d) => ({
      id: `dep:${d}->${f.path}`,
      source: d,
      target: f.path,
      style: { stroke: 'var(--faint)', strokeWidth: 1.25 },
    })),
  )

  if (!files.length) {
    return <div className="flex h-full items-center justify-center text-sm text-faint">Waiting for files</div>
  }

  const fileClaims = claims.filter((c) => c.path === selectedFile)
  const fileAlerts = open.filter((a) => selectedFile && alertTargets(s, a).files.includes(selectedFile))
  const legend = Object.values(agents).filter((a) => claims.some((c) => c.agentId === a.id) || a.currentFile)

  return (
    <ReactFlow
      nodes={liveNodes}
      edges={depEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => n.type === 'file' && selectFile(n.id)}
      onPaneClick={() => selectFile(null)}
      colorMode={theme}
      minZoom={0.2}
      fitView
    >
      <Background color="var(--line)" gap={24} />
      <Controls showInteractive={false} />
      <MiniMap<MapNode>
        pannable
        zoomable
        nodeColor={(n) => (n.type !== 'file' ? 'transparent' : n.data.drift ? 'var(--danger)' : n.data.border ?? 'var(--line)')}
        maskColor="color-mix(in srgb, var(--surface) 75%, transparent)"
      />
      <Panel position="top-right">
        <div className="flex max-w-xs flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-muted shadow-sm">
          {legend.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: `${agentColor(agents, a.id)}2e`, border: `1px solid ${agentColor(agents, a.id)}` }} />
              {a.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border-2 border-warn" />
            Owns a drifting contract
          </span>
          <span className="w-full text-faint">Shaded = claimed - initial = editing now</span>
        </div>
      </Panel>
      {selectedFile && (
        <div className="absolute top-4 left-4 z-10 w-72 rounded-xl border border-line bg-canvas p-4 text-xs shadow-lg">
          <div className="mb-2 font-mono break-all">{selectedFile}</div>
          {fileClaims.map((c) => (
            <div key={c.agentId} className="mb-1">
              <span className="font-medium">{agents[c.agentId]?.name}</span>
              <span className="text-muted">: {c.intent}</span>
            </div>
          ))}
          {fileAlerts.map((a) => (
            <div key={a.id} className="mt-1 text-danger">{a.message}</div>
          ))}
          {!fileClaims.length && !fileAlerts.length && <div className="text-faint">Unclaimed</div>}
        </div>
      )}
    </ReactFlow>
  )
}
