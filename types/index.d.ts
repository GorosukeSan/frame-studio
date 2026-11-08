export type Status = {
  server: 'stopped' | 'starting' | 'running'
  /** the editor's URL once the server runs */
  url: string
  /** one line about the last thing that happened */
  note: string
  /** prompts delivered from the editor this session */
  sent: number
  /** the folder the last send wrote */
  lastDir: string
}

declare module 'claude-code' {
  interface PluginState {
    'frame-studio': { status: Shaped<Status> }
  }
}
