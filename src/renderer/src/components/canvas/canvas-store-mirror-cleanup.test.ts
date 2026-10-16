// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeCanvasTerminalMirror } from './nodes/canvas-agent-session'
import { closeCanvasBrowserMirror } from './nodes/canvas-browser-session'
import { useCrewCanvas, type CrewCanvasGraph } from './canvas-store'

vi.mock('./nodes/canvas-agent-session', () => ({ closeCanvasTerminalMirror: vi.fn() }))
vi.mock('./nodes/canvas-browser-session', () => ({ closeCanvasBrowserMirror: vi.fn() }))

function graph(nodes: CrewCanvasGraph['nodes']): CrewCanvasGraph {
  return {
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    edgeStyle: 'lineit'
  }
}

describe('Canvas native mirror cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCrewCanvas.setState({ canvases: {} })
    localStorage.clear()
  })

  it('closes only the native terminal mirror removed from its owning Canvas', () => {
    const terminalData = {
      kind: 'terminal' as const,
      mirrorTabId: 'terminal-tab',
      mirrorWorktreeId: 'worktree-chutaae'
    }
    useCrewCanvas.setState({
      canvases: {
        'canvas-chutaae': graph([
          {
            id: 'terminal-chutaae',
            type: 'terminal',
            position: { x: 0, y: 0 },
            data: terminalData
          }
        ]),
        'canvas-orca': graph([
          {
            id: 'agent-orca',
            type: 'agent',
            position: { x: 0, y: 0 },
            data: { kind: 'agent', mirrorWorktreeId: 'worktree-orca' }
          }
        ])
      }
    })

    useCrewCanvas.getState().removeElements('canvas-chutaae', ['terminal-chutaae'], [])

    expect(closeCanvasTerminalMirror).toHaveBeenCalledOnce()
    expect(closeCanvasTerminalMirror).toHaveBeenCalledWith(terminalData)
    expect(useCrewCanvas.getState().canvases['canvas-orca']?.nodes).toEqual([
      expect.objectContaining({ id: 'agent-orca' })
    ])
    expect(closeCanvasBrowserMirror).not.toHaveBeenCalled()
  })

  it('closes every terminal-backed mirror when its Canvas tab is removed', () => {
    useCrewCanvas.setState({
      canvases: {
        'canvas-mcgames': graph([
          {
            id: 'agent-mcgames',
            type: 'agent',
            position: { x: 0, y: 0 },
            data: { kind: 'agent', mirrorTabId: 'agent-tab', mirrorWorktreeId: 'mcgames' }
          },
          {
            id: 'terminal-mcgames',
            type: 'terminal',
            position: { x: 0, y: 0 },
            data: {
              kind: 'terminal',
              mirrorTabId: 'terminal-tab',
              mirrorWorktreeId: 'mcgames'
            }
          }
        ])
      }
    })

    useCrewCanvas.getState().removeCanvas('canvas-mcgames')

    expect(closeCanvasTerminalMirror).toHaveBeenCalledTimes(2)
    expect(useCrewCanvas.getState().canvases['canvas-mcgames']).toBeUndefined()
  })
})
