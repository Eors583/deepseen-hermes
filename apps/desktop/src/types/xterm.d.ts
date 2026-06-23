declare module '@xterm/xterm' {
  export interface IDisposable {
    dispose(): void
  }

  export interface IEvent<T = void> {
    (listener: (arg: T) => void): IDisposable
  }

  export interface ITerminalAddon extends IDisposable {
    activate(terminal: Terminal): void
  }

  export interface ITheme {
    background?: string
    foreground?: string
    cursor?: string
    cursorAccent?: string
    selectionBackground?: string
    black?: string
    red?: string
    green?: string
    yellow?: string
    blue?: string
    magenta?: string
    cyan?: string
    white?: string
    brightBlack?: string
    brightRed?: string
    brightGreen?: string
    brightYellow?: string
    brightBlue?: string
    brightMagenta?: string
    brightCyan?: string
    brightWhite?: string
    [key: string]: string | undefined
  }

  export interface IBufferLine {
    translateToString(trimRight?: boolean): string
  }

  export interface IBuffer {
    baseY: number
    cursorY: number
    length: number
    getLine(y: number): IBufferLine | undefined
  }

  export interface IBufferNamespace {
    active: IBuffer
  }

  export interface ISelectionPosition {
    start: { x: number; y: number }
    end: { x: number; y: number }
  }

  export interface ITerminalOptions {
    allowProposedApi?: boolean
    allowTransparency?: boolean
    convertEol?: boolean
    cursorBlink?: boolean
    fontFamily?: string
    fontSize?: number
    lineHeight?: number
    macOptionClickForcesSelection?: boolean
    macOptionIsMeta?: boolean
    minimumContrastRatio?: number
    scrollback?: number
    theme?: ITheme
  }

  export class Terminal {
    buffer: IBufferNamespace
    cols: number
    options: ITerminalOptions
    rows: number
    unicode: { activeVersion: string }

    constructor(options?: ITerminalOptions)

    clearSelection(): void
    dispose(): void
    focus(): void
    getSelection(): string
    getSelectionPosition(): ISelectionPosition | undefined
    hasSelection(): boolean
    loadAddon(addon: ITerminalAddon): void
    onData(listener: (data: string) => void): IDisposable
    onSelectionChange(listener: () => void): IDisposable
    open(parent: HTMLElement): void
    write(data: string): void
  }
}
