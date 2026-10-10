import { useEffect, useMemo } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, useNodesState, useReactFlow } from '@xyflow/react'
import { useStore } from '../store'

const COL = 230
const ROW = 58

// Turn flat file paths into a left-to-right tree layout.
function layoutTree(files) {
  const root = { id: 'd:', name: 'repo', children: new Map() }
  for (const f of files) {
    let node = root
    const parts = f.path.split('/')
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const isFile = i === parts.length - 1
      if (!node.children.has(part)) node.children.set(part, { id: isFile ? path : `d:${path}`, name: part, isFile, children: new Map() })
      node = node.children.get(part)
    })
  }
  const nodes = []
  const edges = []
  let row = 0
  const walk = (n, depth, parent) => {
    const kids = [...n.children.values()].sort((a, b) => a.isFile - b.isFile || a.name.localeCompare(b.name))
    let y
    if (!kids.length) y = row++ * ROW
    else {
      const ys = kids.map((k) => walk(k, depth + 1, n.id))
      y = (Math.min(...ys) + Math.max(...ys)) / 2
    }
    nodes.push({ id: n.id, type: n.isFile ? 'file' : 'dir', position: { x: depth * COL, y }, data: { name: n.name } })
    if (parent) edges.push({ id: `t:${parent}->${n.id}`, source: parent, target: n.id, type: 'smoothstep', style: { stroke: '#3f3f46' } })
    return y
  }
  walk(root, 0, null)
  return { nodes, edges }
}

function DirNode({ data }) {
  return (
    <div className="rounded px-2 py-1 font-mono text-xs text-zinc-400" style={{ opacity: data.dim ? 0.3 : 1 }}>
      <Handle type="target" position={Position.Left} />
      📁 {data.name}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function FileNode({ data }) {
  const { name, claimants, touching, alert, dim, selected } = data
  const ring = alert === 'collision' ? 'ring-2 ring-red-500 animate-flash' : alert === 'drift' ? 'ring-2 ring-amber-400 animate-flash' : selected ? 'ring-1 ring-zinc-400' : ''
  return (
    <div
      className={`relative w-48 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 font-mono text-xs transition-opacity ${ring}`}
      style={{ opacity: dim ? 0.25 : 1 }}
    >
      <Handle type="target" position={Position.Left} />
      {/* One color stripe per claiming agent */}
      <div className="absolute inset-y-0 left-0 flex">
        {claimants.map((c) => <div key={c} className="w-1.5" style={{ background: c }} />)}
      </div>
      <div className="flex items-center gap-1 py-2 pr-2" style={{ paddingLeft: 8 + claimants.length * 6 }}>
        <span className="truncate text-zinc-200">{name}</span>
        <div className="ml-auto flex -space-x-1">
          {touching.map((a) => (
            <span
              key={a.id}
              title={`${a.name} editing`}
              className="flex h-5 w-5 animate-pulse items-center justify-center rounded-full text-[10px] font-bold text-zinc-950 ring-2 ring-zinc-900"
              style={{ background: a.color }}
            >
              {a.name[0]}
            </span>
          ))}
        </div>
      </div>
      {alert && (
        <div className={`px-2 pb-1 text-[10px] font-semibold uppercase ${alert === 'collision' ? 'text-red-400' : 'text-amber-400'}`}>
          ⚠ {alert}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { file: FileNode, dir: DirNode }

export default function CodebaseMap() {
  const { files, agents, claims, alerts, hoveredAgent, selectedFile, selectFile, connection } = useStore()
  const { fitView } = useReactFlow()
  const fileKey = files.map((f) => f.path).join('|')
  const tree = useMemo(() => layoutTree(files), [fileKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState([])

  // Re-layout only when the file set changes (keeps user drags otherwise).
  useEffect(() => {
    setNodes(tree.nodes)
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50)
  }, [tree, setNodes, fitView])

  // Live state -> node data.
  const open = alerts.filter((a) => a.status === 'open')
  const dataFor = (id, base) => {
    const cl = claims.filter((c) => c.path === id)
    const touching = Object.values(agents).filter((a) => a.currentFile === id)
    const hit = open.filter((a) => a.files.includes(id))
    const alert = hit.some((a) => a.type === 'collision') ? 'collision' : hit.length ? 'drift' : null
    const involved = cl.some((c) => c.agentId === hoveredAgent) || touching.some((a) => a.id === hoveredAgent)
    const dim = !!hoveredAgent && (base.type === 'dir' || !involved)
    return {
      ...base.data,
      claimants: cl.map((c) => agents[c.agentId]?.color ?? '#71717a'),
      touching,
      alert,
      dim,
      selected: id === selectedFile,
    }
  }
  const liveNodes = nodes.map((n) => ({ ...n, data: dataFor(n.id, n) }))

  // Dependency edges; light up the ones on a drift path.
  const driftFiles = new Set(open.filter((a) => a.type === 'drift').flatMap((a) => a.files))
  const depEdges = files.flatMap((f) =>
    (f.deps ?? []).map((d) => {
      const hot = driftFiles.has(f.path) && driftFiles.has(d)
      return {
        id: `dep:${f.path}->${d}`,
        source: d,
        target: f.path,
        animated: hot,
        style: { stroke: hot ? '#fbbf24' : '#52525b', strokeDasharray: hot ? undefined : '4 4', strokeWidth: hot ? 2 : 1 },
      }
    }),
  )

  if (!files.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        {connection === 'live' ? 'Connected. Waiting for the backend to send files…' : 'Waiting for backend on /ws…'}
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={liveNodes}
      edges={[...tree.edges, ...depEdges]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => n.type === 'file' && selectFile(n.id)}
      onPaneClick={() => selectFile(null)}
      colorMode="dark"
      minZoom={0.2}
      fitView
    >
      <Background color="#27272a" gap={24} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={(n) => (n.data.alert ? '#ef4444' : n.data.claimants?.[0] ?? '#3f3f46')} maskColor="rgba(9,9,11,.7)" />
    </ReactFlow>
  )
}
