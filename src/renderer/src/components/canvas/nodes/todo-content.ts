export type TodoItem = { id: string; text: string; done: boolean }

export function formatTodoClipboardText(title: string, items: TodoItem[]): string {
  const lines = items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
  return [title, ...(lines.length > 0 ? ['', ...lines] : [])].join('\n')
}
