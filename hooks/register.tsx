import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Status } from '../types'

// Frame Studio: a real Canvas editor (editor.html) served by server.py on
// localhost, opened in the Browser pane. "AIに送信" in the editor writes the
// frames to <cwd>/.frame-studio/<stamp>/ and queues a prompt in the server's
// outbox; this module polls the outbox and submits each prompt to the model.

const PANE = 'frame-studio'
const PORT = 48123
const BASE = `http://localhost:${PORT}`

const INITIAL: Status = { server: 'stopped', url: BASE, note: '', sent: 0, lastDir: '' }
// Change the tag when Status's fields change: what an earlier version stored outlives a reload.
const statusAtom = atom({ plugin: 'frame-studio', key: 'status' } as const, INITIAL, { shape: 'status-1' })

type Outbox = { id: string; mode: 'submit' | 'fill'; text: string; dir: string }[]

// Module state: starts over on a reload (the server process of an earlier load ends with it).
let poller: Timer | null = null
let isPolling = false
let isStarting = false

const patch = ($: EngineInterface, p: Partial<Status>) => update($, statusAtom, s => ({ ...s, ...p }))

const ping = async ($: EngineInterface): Promise<boolean> => {
  try {
    const r = await $.http.fetch(`${BASE}/api/ping`)

    return r.ok && r.text.includes('"ok"')
  } catch {
    return false
  }
}

const findPython = async ($: EngineInterface): Promise<string | null> => {
  for (const exe of ['python', 'py', 'python3']) {
    try {
      const r = await $.process.run([exe, '-c', 'import sys; print(sys.version_info[0])'], { timeoutMs: 20000 })
      if (r.exitCode === 0 && r.stdout.trim().startsWith('3')) return exe
    } catch {
      // not this one
    }
  }

  return null
}

/** Delivers what the editor queued: each prompt submitted (or put in the box), then acknowledged. */
const deliver = async ($: EngineInterface) => {
  if (isPolling) return
  isPolling = true
  try {
    let r
    try {
      r = await $.http.fetch(`${BASE}/api/outbox`)
    } catch {
      await patch($, { server: 'stopped', note: 'サーバーに届きません。/frame-studio で起動し直してください' })
      poller?.cancel()
      poller = null

      return
    }
    if (!r.ok) return
    const list = JSON.parse(r.text) as Outbox
    for (const item of list) {
      await $.http.fetch(`${BASE}/api/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [item.id] }),
      })
      if (item.mode === 'fill') {
        await $.prompt.fill({ text: item.text, mode: 'replace' })
        await patch($, { note: 'プロンプト欄に入れました（編集して送信してください）', lastDir: item.dir })
      } else {
        void $.prompt.submit({ text: item.text, asUser: true })
        await update($, statusAtom, s => ({ ...s, sent: s.sent + 1, note: 'エディタからの指示を送りました', lastDir: item.dir }))
      }
    }
  } finally {
    isPolling = false
  }
}

const watch = ($: EngineInterface) => {
  poller?.cancel()
  poller = $.clock.every(1000, () => void deliver($))
}

/** Starts server.py unless one already answers on the port; then watches its outbox. */
const startServer = async ($: EngineInterface): Promise<boolean> => {
  if (isStarting) return false
  isStarting = true
  try {
    if (await ping($)) {
      await patch($, { server: 'running', note: 'サーバーは起動済みです' })
      watch($)

      return true
    }
    await patch($, { server: 'starting', note: 'サーバーを起動中…' })
    const exe = await findPython($)
    if (!exe) {
      await patch($, { server: 'stopped', note: 'Python 3 が見つかりません（python / py / python3）' })

      return false
    }
    const cwd = await $.session.cwd()
    const script = `${$.plugin.root}/hooks/server.py`
    // the child lives on after this hook returns, and ends with the module
    void (async () => {
      try {
        const child = $.process.spawn({ argv: [exe, script, '--port', String(PORT), '--workdir', cwd] })
        for await (const piece of child) $.ui.log(`server: ${piece.text.trim()}`, { to: 'debug' })
      } catch (err) {
        $.ui.log(`server ended: ${String(err)}`, { to: 'debug' })
      }
      poller?.cancel()
      poller = null
      await patch($, { server: 'stopped', note: 'サーバーが終了しました' })
    })()
    for (let i = 0; i < 40; i += 1) {
      await $.clock.sleep(250)
      if (await ping($)) {
        await patch($, { server: 'running', note: 'サーバーが起動しました' })
        watch($)

        return true
      }
    }
    await patch($, { server: 'stopped', note: `起動できませんでした（ポート ${PORT} が使えない可能性）` })

    return false
  } finally {
    isStarting = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'frame-studio', description: 'Frame Studio（Canvas エディタ）のサーバーを起動してペインを開く' })
    await patch($, { server: 'stopped', note: '' })

    return next(e)
  })

  on('command.run', { command: 'frame-studio' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Frame Studio' })
    const ok = await startServer($)
    const status = await read($, statusAtom)

    return {
      text: ok
        ? `Frame Studio のエディタ: ${BASE} （Browser ペインか普通のブラウザで開いてください。エディタの「AIに送信」がこのセッションに届きます）`
        : `Frame Studio を起動できませんでした: ${status.note}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const s = await read($, statusAtom)
    const state = s.server === 'running' ? '起動中' : s.server === 'starting' ? '起動しています…' : '停止'

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          サーバー: <Text bold>{state}</Text>
        </Text>
        <Link href={BASE} label={`エディタを開く ${BASE}`} />
        <Text dimColor>Browser ペインか普通のブラウザで上の URL を開くと、Canvas エディタが使えます。</Text>
        <Text dimColor>エディタの「AIに送信」を押すと、フレームの PNG/GIF を書き出して、指示がこのセッションに届きます。</Text>
        <Box gap={1}>
          <Button key="start" label={s.server === 'running' ? '再接続' : '起動'} onPress={() => void startServer($)} />
          <Button key="check" label="受信を確認" onPress={() => void deliver($)} />
        </Box>
        <Text dimColor>送った回数: {s.sent}</Text>
        {s.lastDir !== '' && <Text dimColor>最後の書き出し: {s.lastDir}</Text>}
        {s.note !== '' && <Text dimColor>{s.note}</Text>}
      </Box>
    )
  })
}
