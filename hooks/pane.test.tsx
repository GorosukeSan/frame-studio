import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'frame-studio',
  component: 'Pane',
  requestId: 'frame-studio',
  props: {
    title: 'Frame Studio',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the pane shows the editor link and the server state on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Link', text: /48123/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /サーバー/ }))?.text).toMatch(/停止/)
    await ui.unmount()
  }
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: { server: 'running' }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /サーバー/ }))?.text).toMatch(/停止/)
  await ui.unmount()
})
