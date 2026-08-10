import { useCrewCanvas } from './canvas-store'

export function todoTool(
  tabId: string,
  nodeId: string,
  tool: string,
  args: Record<string, unknown>
): string {
  const graph = useCrewCanvas.getState().canvases[tabId]
  const node = graph?.nodes.find((n) => n.id === nodeId)
  type Item = { id: string; text: string; done: boolean }
  const items = (node?.data.items as Item[] | undefined) ?? []
  if (tool === 'todo.list') {
    if (items.length === 0) {
      return '(todo vazio)'
    }
    return items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.id.slice(0, 8)} ${i.text}`).join('\n')
  }
  if (tool === 'todo.add') {
    const text = String(args.text ?? '').trim()
    if (!text) {
      return 'erro: text obrigatório'
    }
    const next = [...items, { id: crypto.randomUUID(), text, done: false }]
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, { items: next })
    return `adicionado (${next.length} itens)`
  }
  if (tool === 'todo.toggle') {
    const prefix = String(args.itemId ?? '')
    const item = items.find((i) => i.id.startsWith(prefix))
    if (!item) {
      return `erro: item "${prefix}" não encontrado (use o prefixo do todo.list)`
    }
    const next = items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, { items: next })
    return `${item.done ? 'reaberto' : 'concluído'}: ${item.text}`
  }
  return `erro: tool desconhecida ${tool}`
}
