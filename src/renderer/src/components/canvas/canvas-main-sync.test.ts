// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CrewCanvasPersistedState,
  CrewCanvasSyncResult,
  CrewCanvasUpdateEvent
} from '../../../../shared/crew-canvas'

const emptyGraph = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  edgeStyle: 'lineit'
}

function persistedState(revision: number): CrewCanvasPersistedState {
  return {
    version: 1,
    revision,
    tabs: {
      'tab-canvas': {
        tabId: 'tab-canvas',
        worktreeId: 'worktree-canvas',
        graph: emptyGraph
      }
    }
  }
}

function isolatedWorkspaceState(revision: number): CrewCanvasPersistedState {
  return {
    version: 1,
    revision,
    tabs: {
      'tab-orca': {
        tabId: 'tab-orca',
        worktreeId: 'worktree-orca',
        graph: {
          ...emptyGraph,
          nodes: [
            {
              id: 'agent-orca',
              type: 'agent',
              position: { x: 10, y: 20 },
              data: { kind: 'agent', label: 'codex' }
            }
          ]
        }
      },
      'tab-chutaae': {
        tabId: 'tab-chutaae',
        worktreeId: 'worktree-chutaae',
        graph: {
          ...emptyGraph,
          nodes: [
            {
              id: 'browser-chutaae',
              type: 'browser',
              position: { x: 30, y: 40 },
              data: { kind: 'browser', browserWorkspaceId: 'browser-workspace-chutaae' }
            }
          ]
        }
      }
    }
  }
}

describe('crew Canvas main synchronization', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('protects a local node from a concurrent main update before persistence completes', async () => {
    let resolveSync!: (result: CrewCanvasSyncResult) => void
    let updateListener: (event: CrewCanvasUpdateEvent) => void = (): void => {}
    const syncCanvas = vi.fn(
      (_request: unknown) =>
        new Promise<CrewCanvasSyncResult>((resolve) => {
          resolveSync = resolve
        })
    )
    const crewApi = {
      getCanvasState: vi.fn().mockResolvedValue(persistedState(1)),
      syncCanvas,
      removeCanvas: vi.fn(),
      onCanvasUpdate: vi.fn((listener: (event: CrewCanvasUpdateEvent) => void) => {
        updateListener = listener
        return (): void => {}
      })
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { crew: crewApi } as unknown as typeof window.api
    })
    const mainSync = await import('./canvas-main-sync')
    const { useCrewCanvas } = await import('./canvas-store')
    mainSync.registerCrewCanvasTabScope('tab-canvas', 'worktree-canvas')
    mainSync.installCrewCanvasMainUpdates()
    await mainSync.hydrateCrewCanvasFromMain()

    useCrewCanvas.getState().addNode('tab-canvas', {
      id: 'node-durable',
      type: 'note',
      position: { x: 10, y: 20 },
      data: { kind: 'note', text: 'durable' }
    })
    updateListener({ state: persistedState(2), reason: 'mutation' })

    expect(useCrewCanvas.getState().canvases['tab-canvas']?.nodes).toEqual([
      expect.objectContaining({ id: 'node-durable' })
    ])
    await vi.waitFor(() => expect(syncCanvas).toHaveBeenCalledOnce())

    resolveSync({ accepted: true, revision: 3 })
    await vi.waitFor(() => expect(syncCanvas.mock.calls.at(-1)?.[0]).toBeDefined())

    expect(syncCanvas.mock.calls.at(-1)?.[0]).toMatchObject({
      tabId: 'tab-canvas',
      worktreeId: 'worktree-canvas',
      graph: { nodes: [expect.objectContaining({ id: 'node-durable' })] }
    })
    expect(useCrewCanvas.getState().canvases['tab-canvas']?.nodes).toHaveLength(1)
  })

  it('retains pending graph work without a runaway retry after a persistence failure', async () => {
    let updateListener: (event: CrewCanvasUpdateEvent) => void = (): void => {}
    const syncCanvas = vi
      .fn((_request: unknown) =>
        Promise.resolve<CrewCanvasSyncResult>({ accepted: true, revision: 2 })
      )
      .mockRejectedValueOnce(new Error('disk unavailable'))
    const crewApi = {
      getCanvasState: vi.fn().mockResolvedValue(persistedState(1)),
      syncCanvas,
      removeCanvas: vi.fn(),
      onCanvasUpdate: vi.fn((listener: (event: CrewCanvasUpdateEvent) => void) => {
        updateListener = listener
        return (): void => {}
      })
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { crew: crewApi } as unknown as typeof window.api
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mainSync = await import('./canvas-main-sync')
    const { useCrewCanvas } = await import('./canvas-store')
    mainSync.registerCrewCanvasTabScope('tab-canvas', 'worktree-canvas')
    mainSync.installCrewCanvasMainUpdates()
    await mainSync.hydrateCrewCanvasFromMain()

    useCrewCanvas.getState().addNode('tab-canvas', {
      id: 'node-retry',
      type: 'note',
      position: { x: 10, y: 20 },
      data: { kind: 'note', text: 'first' }
    })
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce())
    expect(syncCanvas).toHaveBeenCalledOnce()

    useCrewCanvas.getState().updateNodeData('tab-canvas', 'node-retry', { text: 'second' })
    await vi.waitFor(() => expect(syncCanvas).toHaveBeenCalledTimes(2))
    expect(syncCanvas.mock.calls[1]?.[0]).toMatchObject({
      graph: {
        nodes: [expect.objectContaining({ data: expect.objectContaining({ text: 'second' }) })]
      }
    })
    expect(updateListener).toBeTypeOf('function')
    warning.mockRestore()
  })

  it('keeps another workspace intact while a browser deletion conflicts with main state', async () => {
    let resolveSync!: (result: CrewCanvasSyncResult) => void
    let updateListener: (event: CrewCanvasUpdateEvent) => void = (): void => {}
    const syncCanvas = vi.fn(
      (_request: unknown) =>
        new Promise<CrewCanvasSyncResult>((resolve) => {
          resolveSync = resolve
        })
    )
    const crewApi = {
      getCanvasState: vi.fn().mockResolvedValue(isolatedWorkspaceState(1)),
      syncCanvas,
      removeCanvas: vi.fn(),
      onCanvasUpdate: vi.fn((listener: (event: CrewCanvasUpdateEvent) => void) => {
        updateListener = listener
        return (): void => {}
      })
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { crew: crewApi } as unknown as typeof window.api
    })
    const mainSync = await import('./canvas-main-sync')
    const { useCrewCanvas } = await import('./canvas-store')
    mainSync.registerCrewCanvasTabScope('tab-orca', 'worktree-orca')
    mainSync.registerCrewCanvasTabScope('tab-chutaae', 'worktree-chutaae')
    mainSync.installCrewCanvasMainUpdates()
    await mainSync.hydrateCrewCanvasFromMain()

    useCrewCanvas.getState().removeElements('tab-chutaae', ['browser-chutaae'], [])
    await vi.waitFor(() => expect(syncCanvas).toHaveBeenCalledOnce())
    updateListener({ state: isolatedWorkspaceState(2), reason: 'mutation' })

    expect(useCrewCanvas.getState().canvases['tab-orca']?.nodes).toEqual([
      expect.objectContaining({ id: 'agent-orca' })
    ])
    expect(useCrewCanvas.getState().canvases['tab-chutaae']?.nodes).toEqual([])

    resolveSync({ accepted: true, revision: 3 })
    await vi.waitFor(() =>
      expect(syncCanvas.mock.calls[0]?.[0]).toMatchObject({
        tabId: 'tab-chutaae',
        worktreeId: 'worktree-chutaae',
        graph: { nodes: [] }
      })
    )
  })
})
