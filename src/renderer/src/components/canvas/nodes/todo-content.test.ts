import { describe, expect, it } from 'vitest'
import { formatTodoClipboardText } from './todo-content'

describe('Todo clipboard content', () => {
  it('formats the title and checklist state as Markdown', () => {
    expect(
      formatTodoClipboardText('ChutaAe — Regulamentação e Predict Market', [
        { id: 'one', text: 'Revisar regras', done: true },
        { id: 'two', text: 'Validar fluxo', done: false }
      ])
    ).toBe('ChutaAe — Regulamentação e Predict Market\n\n- [x] Revisar regras\n- [ ] Validar fluxo')
  })

  it('keeps the title when the checklist is empty', () => {
    expect(formatTodoClipboardText('todo', [])).toBe('todo')
  })
})
