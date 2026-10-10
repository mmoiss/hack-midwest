import { useEffect, useMemo, useRef } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Panel, Handle, Position, useNodesState, useNodesInitialized, useReactFlow, type Node, type Edge, type NodeProps } from '@xyflow/react'
import { useStore, agentColor, alertTargets, type FileEntry } from '../store'
import { alertFiles, edgeAlerts } from '../alertGraph'

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
  const { base, dir, tint, border, owner, drift, touching, dim, selected } = data
  return (
    <div
      className="relative w-48 rounded-lg px-2.5 py-1.5 font-mono text-xs transition-opacity"
      style={{
        background: tint ?? 'var(--canvas)',
        border: owner ? '2px solid var(--warn)' : drift ? '2px solid var(--danger)' : `1px solid ${border ?? 'var(--line)'}`,
        boxShadow: selected ? '0 0 0 2px var(--faint)' : undefined,
        opacity: dim ? 0.25 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="truncate font-medium">{base}</div>
      <div className="truncate text-[11px] text-faint">{dir || ' '}</div>
      {drift && <div className={`mt-1 text-[10px] ${owner ? 'text-warn' : 'text-danger'}`}>{owner ? 'Contract owner' : 'Affected consumer'}</div>}
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
  const { files, agents, claims, alerts, hoveredAgent, selectedFile, selectedAlert, selectFile, focusAlert, mapFocusVersion, theme } = s
  const { fitView } = useReactFlow()
  const initialized = useNodesInitialized()
  const lastFocus = useRef('')
  const fileKey = files.map((f) => `${f.path}<${f.deps.join(',')}`).join('|')
  const layout = useMemo(() => layoutColumns(files), [fileKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([])

  // Re-layout only when the file set changes (keeps user drags otherwise).
  useEffect(() => {
    setNodes(layout)
  }, [layout, setNodes])

  // Live state -> node data.
  const open = alerts.filter((a) => a.status === 'open')
  const driftFiles = new Set(open.flatMap(alertFiles))
  const owners = new Set(open.map((a) => a.owner).filter(Boolean))
  const focusedAlert = alerts.find((a) => a.id === selectedAlert)
  const focusPaths = selectedFile ? [selectedFile] : focusedAlert ? alertFiles(focusedAlert) : []
  const focusKey = JSON.stringify([mapFocusVersion, selectedAlert, focusPaths, fileKey])
  const nodesKey = nodes.map((n) => n.id).join('|')

  // Wait for React Flow to measure newly arrived nodes; don't recenter on every
  // unrelated event, hover, or drag. Remounts also focus the selected alert.
  useEffect(() => {
    if (!initialized || lastFocus.current === focusKey) return
    if (focusPaths.some((path) => !nodes.some((n) => n.id === path))) return
    lastFocus.current = focusKey
    void fitView({
      nodes: focusPaths.length ? focusPaths.map((id) => ({ id })) : undefined,
      padding: 0.35, maxZoom: 1.2, duration: 500,
    })
  }, [initialized, focusKey, nodesKey, fitView]) // eslint-disable-line react-hooks/exhaustive-deps
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
        owner: owners.has(n.id),
        drift,
        touching,
        dim: !!hoveredAgent && !involved,
        selected: n.id === selectedFile,
      },
    }
  })

  const depEdges: Edge[] = files.flatMap((f) =>
    f.deps.map((d) => {
      const breaks = edgeAlerts(open, d, f.path)
      return {
        id: JSON.stringify([d, f.path]), source: d, target: f.path,
        animated: breaks.length > 0,
        label: breaks.map((a) => a.contract).filter(Boolean).join(', ') || undefined,
        style: { stroke: breaks.length ? 'var(--warn)' : 'var(--faint)', strokeWidth: breaks.length ? 2.5 : 1.25 },
        labelStyle: { fill: 'var(--fg)', fontSize: 11 },
        labelBgStyle: { fill: 'var(--canvas)' },
        data: { alertId: breaks[0]?.id },
      }
    }),
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
      onEdgeClick={(_, edge) => { if (edge.data?.alertId) focusAlert(String(edge.data.alertId)) }}
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
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-danger" />Affected consumer</span>
          <span className="w-full text-faint">Animated edges show affected dependencies. Click to inspect.</span>
          <span className="w-full text-faint">Shaded = claimed - initial = editing now</span>
        </div>
      </Panel>
      {focusedAlert && !selectedFile && (
        <Panel position="top-left">
          <div className="max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-line bg-canvas p-4 text-xs shadow-lg">
            <div className="font-semibold">{focusedAlert.contract ?? 'Contract context unavailable'}</div>
            <p className="mt-2">{focusedAlert.message}</p>
            {focusedAlert.suggestion && <p className="mt-2 text-muted">{focusedAlert.suggestion}</p>}
            {focusedAlert.editId && <p className="mt-2 text-faint">Originating edit #{focusedAlert.editId}</p>}
            {focusedAlert.owner && <div className="mt-3"><span className="text-warn">Owner</span><button className="mt-1 block text-left font-mono break-all hover:underline" onClick={() => selectFile(focusedAlert.owner!)}>{focusedAlert.owner}</button></div>}
            {!!focusedAlert.consumers?.length && <div className="mt-3 text-danger">Affected consumers</div>}
            {focusedAlert.consumers?.map((path) => <button key={path} className="mt-1 block text-left font-mono break-all hover:underline" onClick={() => selectFile(path)}>{path}</button>)}
            {!alertFiles(focusedAlert).length && <p className="mt-2 text-faint">This alert has no recorded file context.</p>}
          </div>
        </Panel>
      )}
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
            <button key={a.id} onClick={() => focusAlert(a.id)} className="mt-2 block text-left text-danger hover:underline">{a.contract && <span className="block font-semibold">{a.contract}</span>}{a.message}</button>
          ))}
          {!fileClaims.length && !fileAlerts.length && <div className="text-faint">Unclaimed</div>}
        </div>
      )}
    </ReactFlow>
  )
}
