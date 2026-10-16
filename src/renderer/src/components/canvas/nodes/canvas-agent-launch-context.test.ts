import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCrewCanvas } = vi.hoisted(() => ({ getCrewCanvas: vi.fn() }))

vi.mock('../canvas-store', () => ({ getCrewCanvas }))

describe('resolveCanvasAgentLaunchContext', () => {
  const getBridgeInfo = vi.fn()
  const getIssue = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      api: {
        crew: { getBridgeInfo },
        linear: { getIssue }
      }
    })
    getBridgeInfo.mockResolvedValue({ socketPath: '/tmp/orca.sock', token: 'scoped-token' })
    getIssue.mockResolvedValue({
      identifier: 'ORC-42',
      title: 'Canvas nativo',
      state: { name: 'Em Desenvolvimento' },
      url: 'https://linear.app/orca/issue/ORC-42',
      description: 'Validar contexto.'
    })
    getCrewCanvas.mockReturnValue({
      viewport: { x: 0, y: 0, zoom: 1 },
      edgeStyle: 'lineit',
      nodes: [
        { id: 'self', data: { kind: 'agent', linearIssueId: 'issue-42' } },
        { id: 'peer', data: { kind: 'agent', label: 'revisor', role: 'QA' } },
        { id: 'note', data: { kind: 'note', text: 'contexto conectado' } },
        { id: 'browser-ready', data: { kind: 'browser', browserPageId: 'page-1' } },
        { id: 'browser-pending', data: { kind: 'browser' } },
        { id: 'todo', data: { kind: 'todo' } },
        { id: 'unlinked', data: { kind: 'note', text: 'não incluir' } }
      ],
      edges: [
        { id: 'e-peer', source: 'self', target: 'peer' },
        { id: 'e-note', source: 'note', target: 'self' },
        { id: 'e-browser-ready', source: 'self', target: 'browser-ready' },
        { id: 'e-browser-pending', source: 'browser-pending', target: 'self' },
        { id: 'e-todo', source: 'self', target: 'todo' }
      ]
    })
  })

  it('resolves only connected capabilities and scoped runtime context', async () => {
    const { resolveCanvasAgentLaunchContext } = await import('./canvas-agent-launch-context')

    const context = await resolveCanvasAgentLaunchContext('tab-1', 'self')

    expect(getBridgeInfo).toHaveBeenCalledWith({ nodeId: 'self' })
    expect(context).toMatchObject({
      bridge: { socketPath: '/tmp/orca.sock', token: 'scoped-token' },
      peers: [{ label: 'revisor', role: 'QA' }],
      connectedNotes: ['contexto conectado'],
      connectedKinds: ['agent', 'note', 'browser', 'todo'],
      connectedBrowserPageIds: ['page-1', 'canvas-browser-pending'],
      fresh: { kind: 'agent', linearIssueId: 'issue-42' }
    })
    expect(context.linearContext).toContain('ORC-42 — Canvas nativo')
    expect(context.linearContext).toContain('Validar contexto.')
  })

  it('keeps launching when the linked Linear issue is unavailable', async () => {
    getIssue.mockRejectedValue(new Error('offline'))
    const { resolveCanvasAgentLaunchContext } = await import('./canvas-agent-launch-context')

    const context = await resolveCanvasAgentLaunchContext('tab-1', 'self')

    expect(context.linearContext).toBeUndefined()
    expect(context.peers).toHaveLength(1)
  })
})
