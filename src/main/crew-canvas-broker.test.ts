import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrewCanvasBroker } from './crew-canvas-broker'
import type { OrcaRuntimeService } from './runtime/orca-runtime'

const agent = (id: string, label = id) => ({
  id,
  type: 'agent',
  position: { x: 0, y: 0 },
  data: { kind: 'agent', label }
})

const note = (id: string, text = '') => ({
  id,
  type: 'note',
  position: { x: 0, y: 0 },
  data: { kind: 'note', text }
})

const terminal = (id: string) => ({
  id,
  type: 'terminal',
  position: { x: 0, y: 0 },
  data: { kind: 'terminal', label: id }
})

const browser = (id: string) => ({
  id,
  type: 'browser',
  position: { x: 0, y: 0 },
  data: { kind: 'browser', label: id, browserPageId: `native-${id}` }
})

const resource = (id: string, kind: string, data: Record<string, unknown> = {}) => ({
  id,
  type: kind,
  position: { x: 0, y: 0 },
  data: { kind, label: id, ...data }
})

describe('CrewCanvasBroker', () => {
  let directory: string

  afterEach(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createBroker(
    forwardToRenderer = vi.fn(async () => 'forwarded'),
    runtime: OrcaRuntimeService | null = null
  ): CrewCanvasBroker {
    directory = mkdtempSync(join(tmpdir(), 'orca-crew-canvas-'))
    return new CrewCanvasBroker({
      statePath: join(directory, 'state.json'),
      getRuntime: () => runtime,
      forwardToRenderer,
      getMainWebContents: () => null
    })
  }

  it('persists a graph, exposes only direct capabilities, and rejects stale writes', () => {
    const broker = createBroker()
    const graph = {
      nodes: [
        {
          ...agent('agent-1', 'Planner'),
          selected: true,
          dragging: true,
          resizing: true,
          measured: { width: 560, height: 380 }
        },
        note('note-1', 'brief'),
        terminal('terminal-1')
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'agent-1',
          target: 'note-1',
          selected: true,
          data: { newborn: true }
        }
      ]
    }

    expect(broker.syncTab({ tabId: 'tab-1', worktreeId: 'wt-1', graph, baseRevision: 0 })).toEqual({
      accepted: true,
      revision: 1
    })
    const persistedAgent = broker.getState().tabs['tab-1']!.graph.nodes[0]!
    expect(persistedAgent).not.toHaveProperty('selected')
    expect(persistedAgent).not.toHaveProperty('dragging')
    expect(persistedAgent).not.toHaveProperty('resizing')
    expect(persistedAgent).not.toHaveProperty('measured')
    expect(broker.getState().tabs['tab-1']!.graph.edges[0]).not.toHaveProperty('selected')
    expect(broker.getState().tabs['tab-1']!.graph.edges[0]).not.toHaveProperty('data.newborn')
    expect(
      broker.handle({ requestId: '1', from: 'agent-1', tool: 'capabilities' })
    ).resolves.toEqual(
      JSON.stringify({
        agent: { id: 'agent-1', label: 'Planner', tabId: 'tab-1' },
        revision: 1,
        policy: {
          todo: {
            requiredForMultiStepWork: true,
            minimumActions: 2,
            workflow: ['todo.spawn-if-missing', 'todo.list', 'todo.add-once', 'todo.toggle-on-done']
          }
        },
        connections: [
          {
            id: 'note-1',
            kind: 'note',
            label: 'note',
            tools: ['note.read', 'note.write']
          }
        ]
      })
    )
    expect(broker.syncTab({ tabId: 'tab-1', worktreeId: 'wt-1', graph, baseRevision: 0 })).toEqual({
      accepted: false,
      conflict: true,
      state: expect.objectContaining({ revision: 1 })
    })
  })

  it('executes durable note mutations without waking the renderer', async () => {
    const broker = createBroker()
    const graph = {
      nodes: [agent('agent-1'), note('note-1', 'old')],
      edges: [{ id: 'edge-1', source: 'agent-1', target: 'note-1' }]
    }
    broker.syncTab({ tabId: 'tab-1', graph, baseRevision: 0 })

    await expect(
      broker.handle({
        requestId: '2',
        from: 'agent-1',
        tool: 'note.write',
        args: { nodeId: 'note-1', text: 'new' }
      })
    ).resolves.toBe('nota atualizada (3 chars)')
    await expect(
      broker.handle({
        requestId: '3',
        from: 'agent-1',
        tool: 'note.read',
        args: { nodeId: 'note-1' }
      })
    ).resolves.toBe('new')
  })

  it('does not forward a terminal call unless the edge authorizes it', async () => {
    const forward = vi.fn(async () => 'terminal output')
    const broker = createBroker(forward)
    const graph = {
      nodes: [agent('agent-1'), agent('agent-2'), terminal('terminal-1')],
      edges: [{ id: 'edge-1', source: 'agent-1', target: 'agent-2' }]
    }
    broker.syncTab({ tabId: 'tab-1', graph, baseRevision: 0 })

    await expect(
      broker.handle({
        requestId: '4',
        from: 'agent-1',
        tool: 'terminal.run',
        args: { nodeId: 'terminal-1', command: 'pwd' }
      })
    ).resolves.toContain('não é um terminal conectado')
    expect(forward).not.toHaveBeenCalled()
  })

  it('forwards only admitted agent-to-agent asks', async () => {
    const forward = vi.fn(async () => 'reply')
    const broker = createBroker(forward)
    const graph = {
      nodes: [agent('agent-1'), agent('agent-2')],
      edges: [{ id: 'edge-1', source: 'agent-1', target: 'agent-2' }]
    }
    broker.syncTab({ tabId: 'tab-1', graph, baseRevision: 0 })

    await expect(
      broker.handle({ requestId: '5', from: 'agent-1', tool: 'ask', to: 'agent-2', message: 'hi' })
    ).resolves.toBe('reply')
    expect(forward).toHaveBeenCalledTimes(1)
  })

  it('addresses a connected agent by its Canvas orchestration role', async () => {
    const forward = vi.fn(async () => 'review complete')
    const broker = createBroker(forward)
    const reviewer = {
      ...agent('agent-2'),
      data: { kind: 'agent', agentKind: 'codex', role: 'reviewer' }
    }
    broker.syncTab({
      tabId: 'tab-1',
      graph: {
        nodes: [agent('agent-1', 'Planner'), reviewer],
        edges: [{ id: 'edge-1', source: 'agent-1', target: 'agent-2' }]
      },
      baseRevision: 0
    })

    await expect(
      broker.handle({
        requestId: 'role-ask',
        from: 'Planner',
        tool: 'ask',
        to: 'reviewer',
        message: 'review this'
      })
    ).resolves.toBe('review complete')
    await expect(
      broker.handle({ requestId: 'role-capabilities', from: 'Planner', tool: 'capabilities' })
    ).resolves.toContain('"label":"reviewer"')
  })

  it('routes connected browser actions through the native runtime and worktree', async () => {
    const browserGoto = vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' })
    const browserTabCreate = vi.fn().mockResolvedValue({ browserPageId: 'new-page' })
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      browserGoto,
      browserTabCreate
    } as unknown as OrcaRuntimeService
    const broker = createBroker(undefined, runtime)
    const graph = {
      nodes: [agent('agent-1'), browser('browser-1')],
      edges: [{ id: 'edge-1', source: 'agent-1', target: 'browser-1' }]
    }
    broker.syncTab({ tabId: 'tab-1', worktreeId: 'wt-1', graph, baseRevision: 0 })

    await broker.handle({
      requestId: '6',
      from: 'agent-1',
      tool: 'browser.navigate',
      args: { url: 'https://example.com' }
    })
    expect(browserGoto).toHaveBeenCalledWith({
      page: 'native-browser-1',
      worktree: 'wt-1',
      url: 'https://example.com'
    })

    await broker.handle({
      requestId: '7',
      from: 'agent-1',
      tool: 'browser.tabCreate',
      args: { url: 'https://other.example', activate: false }
    })
    expect(browserTabCreate).toHaveBeenCalledWith({
      worktree: 'wt-1',
      url: 'https://other.example',
      activate: false
    })
  })

  it('advertises the callable operations for every connected Canvas node kind', async () => {
    const broker = createBroker()
    const nodes = [
      agent('agent-1'),
      agent('agent-2'),
      browser('browser-1'),
      terminal('terminal-1'),
      resource('simulator-1', 'simulator'),
      resource('network-1', 'network'),
      note('note-1'),
      resource('todo-1', 'todo'),
      resource('timer-1', 'timer')
    ]
    broker.syncTab({
      tabId: 'tab-1',
      graph: {
        nodes,
        edges: nodes.slice(1).map((node, index) => ({
          id: `edge-${index}`,
          source: 'agent-1',
          target: node.id
        }))
      },
      baseRevision: 0
    })

    const result = JSON.parse(
      await broker.handle({ requestId: '8', from: 'agent-1', tool: 'capabilities' })
    ) as { connections: { kind: string; tools: string[] }[] }
    const toolsByKind = Object.fromEntries(
      result.connections.map((connection) => [connection.kind, connection.tools])
    )

    expect(toolsByKind.agent).toEqual(['canvas_ask', 'orchestrate'])
    expect(toolsByKind.browser).toContain('browser.viewport')
    expect(toolsByKind.terminal).toEqual(['terminal.run'])
    expect(toolsByKind.simulator).toContain('simulator.ax')
    expect(toolsByKind.network).toEqual(['network.read', 'network.snapshot', 'network.list'])
    expect(toolsByKind.note).toEqual(['note.read', 'note.write'])
    expect(toolsByKind.todo).toEqual(['todo.list', 'todo.add', 'todo.toggle'])
    expect(toolsByKind.timer).toEqual([
      'timer.read',
      'timer.start',
      'timer.pause',
      'timer.stop',
      'timer.reset'
    ])
  })
})
