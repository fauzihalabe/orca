import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type Viewport
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'
import type { CrewCanvasNode } from './canvas-store'
import {
  hydrateCrewCanvasFromMain,
  installCrewCanvasMainUpdates,
  syncCrewCanvasTab
} from './canvas-main-sync'
import {
  CanvasTabProvider,
  useCanvasActions,
  useCanvasGraph,
  useCanvasGraphReader,
  useCanvasTab
} from './canvas-tab-context'
import { AgentNode } from './nodes/AgentNode'
import { BrowserNode } from './nodes/BrowserNode'
import { TerminalNode } from './nodes/TerminalNode'
import { NoteNode } from './nodes/NoteNode'
import { TodoNode } from './nodes/TodoNode'
import { TimerNode } from './nodes/TimerNode'
import { SimulatorNode } from './nodes/SimulatorNode'
import { NetworkNode } from './nodes/NetworkNode'
import { CrewEdgeView } from './edges/CrewEdge'
import { installCrewAskListener } from './crew-ask-listener'
import { CreatePalette, type PaletteKind } from './create-palette'
import { EdgeStyleSwitcher } from './edge-style-switcher'
import { useRubberBand } from './use-rubber-band'
import { useAppStore } from '@/store'

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  browser: BrowserNode,
  terminal: TerminalNode,
  note: NoteNode,
  todo: TodoNode,
  timer: TimerNode,
  simulator: SimulatorNode,
  network: NetworkNode
}
const edgeTypes: EdgeTypes = { crew: CrewEdgeView }

const DEFAULT_SIZES: Record<PaletteKind, { width: number; height: number }> = {
  agent: { width: 560, height: 380 },
  browser: { width: 560, height: 460 },
  terminal: { width: 520, height: 340 },
  note: { width: 260, height: 220 },
  todo: { width: 280, height: 300 },
  timer: { width: 220, height: 220 },
  simulator: { width: 400, height: 640 },
  network: { width: 480, height: 360 }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], .xterm, webview')
  )
}

function CanvasSurface() {
  const { tabId, worktreeId, worktreePath, active } = useCanvasTab()
  const defaultTuiAgent = useAppStore((state) => state.settings?.defaultTuiAgent)
  const graph = useCanvasGraph()
  const { nodes, edges } = graph
  const actions = useCanvasActions()
  const readGraph = useCanvasGraphReader()
  const { screenToFlowPosition } = useReactFlow()
  const activeRef = useRef(active)
  const rootRef = useRef<HTMLDivElement>(null)
  activeRef.current = active

  useEffect(() => {
    const releaseInteractionShield = (): void => {
      rootRef.current?.removeAttribute('data-pointer-interaction')
    }
    window.addEventListener('pointerup', releaseInteractionShield, true)
    window.addEventListener('pointercancel', releaseInteractionShield, true)
    window.addEventListener('blur', releaseInteractionShield)
    return () => {
      window.removeEventListener('pointerup', releaseInteractionShield, true)
      window.removeEventListener('pointercancel', releaseInteractionShield, true)
      window.removeEventListener('blur', releaseInteractionShield)
    }
  }, [])

  const shieldNativeGuestsDuringPointerGesture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target
      if (
        target instanceof Element &&
        !target.closest('.nodrag') &&
        target.closest('.drag-handle, .react-flow__resize-control, .react-flow__handle')
      ) {
        rootRef.current?.setAttribute('data-pointer-interaction', 'true')
      }
    },
    []
  )

  useEffect(() => {
    installCrewAskListener()
    installCrewCanvasMainUpdates()
    void hydrateCrewCanvasFromMain()
  }, [])

  useEffect(() => {
    // The renderer remains a responsive React Flow cache; the main process
    // receives every committed graph and fences stale writes by revision.
    void syncCrewCanvasTab(tabId, worktreeId, graph)
  }, [graph, tabId, worktreeId])

  const onNodesChange = useCallback(
    (changes: NodeChange<CrewCanvasNode>[]) => {
      const g = readGraph()
      actions.setGraph(applyNodeChanges(changes, g.nodes), g.edges)
    },
    [actions, readGraph]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const g = readGraph()
      actions.setGraph(g.nodes, applyEdgeChanges(changes, g.edges))
    },
    [actions, readGraph]
  )
  const onMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => actions.setViewport(viewport),
    [actions]
  )

  // Delete/Backspace removes the selection — handled here because PTY xterms
  // and webviews hold keyboard focus, so xyflow's own deleteKeyCode never
  // reaches the pane in real use. Only the VISIBLE canvas answers: hidden
  // tabs stay mounted and would eat the gesture (and their selections).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }
      if (!activeRef.current) {
        return
      }
      if (isEditableTarget(event.target)) {
        return
      }
      const g = readGraph()
      const nodeIds = g.nodes.filter((n) => n.selected).map((n) => n.id)
      const edgeIds = g.edges.filter((e) => e.selected).map((e) => e.id)
      if (nodeIds.length > 0 || edgeIds.length > 0) {
        event.preventDefault()
        actions.removeElements(nodeIds, edgeIds)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, readGraph])

  // A connection is a capability, not a drawing: agents may connect to every
  // resource, and a network node may connect to the browser it observes.
  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      if (!conn.source || !conn.target || conn.source === conn.target) {
        return false
      }
      const g = readGraph()
      if (
        g.edges.some(
          (e) =>
            (e.source === conn.source && e.target === conn.target) ||
            (e.source === conn.target && e.target === conn.source)
        )
      ) {
        return false
      }
      const kindOf = (nodeId: string) => g.nodes.find((n) => n.id === nodeId)?.data.kind
      const pair = [kindOf(conn.source), kindOf(conn.target)]
      return pair.includes('agent') || (pair.includes('browser') && pair.includes('network'))
    },
    [readGraph]
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      const g = readGraph()
      const edgeId = crypto.randomUUID()
      actions.setGraph(g.nodes, [
        ...g.edges,
        {
          id: edgeId,
          source: conn.source,
          target: conn.target,
          type: 'crew',
          data: { newborn: true }
        }
      ])
      setTimeout(() => {
        const cur = readGraph()
        actions.setGraph(
          cur.nodes,
          cur.edges.map((e) =>
            e.id === edgeId ? { ...e, data: { ...e.data, newborn: false } } : e
          )
        )
      }, 900)
    },
    [actions, readGraph]
  )

  // Creation lives on the rubber-band drag (double-click does nothing).
  const [palette, setPalette] = useState<{
    x: number
    y: number
    rect?: { x: number; y: number; width: number; height: number }
  } | null>(null)

  const { band, onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = useRubberBand(
    useCallback((rect, screen) => {
      setPalette({ x: screen.x, y: screen.y, rect })
    }, [])
  )

  const createNode = useCallback(
    (kind: PaletteKind) => {
      if (!palette) {
        return
      }
      const position = palette.rect ?? screenToFlowPosition({ x: palette.x, y: palette.y })
      const size = palette.rect
        ? { width: Math.max(180, palette.rect.width), height: Math.max(140, palette.rect.height) }
        : DEFAULT_SIZES[kind]
      // Agent/terminal nodes spawn PTYs — pin them to this tab's worktree dir.
      const cwd = kind === 'agent' || kind === 'terminal' ? (worktreePath ?? undefined) : undefined
      actions.addNode({
        id: crypto.randomUUID(),
        type: kind,
        position,
        width: size.width,
        height: size.height,
        data: {
          ...(kind === 'agent'
            ? {
                kind,
                agentKind:
                  defaultTuiAgent && defaultTuiAgent !== 'blank' ? defaultTuiAgent : 'claude'
              }
            : { kind }),
          ...(cwd ? { cwd } : {})
        }
      })
      setPalette(null)
    },
    [actions, defaultTuiAgent, palette, screenToFlowPosition, worktreePath]
  )

  return (
    <div
      ref={rootRef}
      className="crew-canvas-root h-full w-full"
      style={{ background: 'var(--background)', position: 'relative' }}
      onPointerDownCapture={shieldNativeGuestsDuringPointerGesture}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveEnd={onMoveEnd}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionRadius={42}
        connectionMode={ConnectionMode.Loose}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'crew', interactionWidth: 24 }}
        zoomOnDoubleClick={false}
        defaultViewport={readGraph().viewport}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
        colorMode="dark"
        panOnDrag={false}
        panOnScroll
        zoomOnScroll={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="rgba(255,255,255,0.14)"
        />
      </ReactFlow>
      {band ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(band.startX, band.currentX),
            top: Math.min(band.startY, band.currentY),
            width: Math.abs(band.currentX - band.startX),
            height: Math.abs(band.currentY - band.startY),
            border: '1.5px dashed rgba(122,162,255,0.65)',
            borderRadius: 10,
            background: 'rgba(122,162,255,0.07)',
            pointerEvents: 'none',
            zIndex: 35
          }}
        />
      ) : null}
      {palette ? (
        <CreatePalette
          x={palette.x}
          y={palette.y}
          onPick={createNode}
          onClose={() => setPalette(null)}
        />
      ) : null}
      <EdgeStyleSwitcher />
    </div>
  )
}

// Crew canvas — the central surface. As a worktree tab it roots at that
// worktree's directory; as the global view it floats unrooted ('default').
export default function CanvasPage({
  tabId = 'default',
  worktreeId,
  worktreePath,
  isActive = true
}: {
  tabId?: string
  worktreeId?: string | null
  worktreePath?: string | null
  isActive?: boolean
}) {
  return (
    <CanvasTabProvider
      tabId={tabId}
      worktreeId={worktreeId}
      worktreePath={worktreePath}
      active={isActive}
    >
      <ReactFlowProvider>
        <CanvasSurface />
      </ReactFlowProvider>
    </CanvasTabProvider>
  )
}
