import { execFile, spawn } from 'child_process'
import type { ChildProcess, ExecFileOptions, SpawnOptions } from 'child_process'
import { existsSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { logger } from '../logger'

export interface HermesInvocation {
  command: string
  argsPrefix: string[]
}

export interface HermesExecResult {
  stdout: string
  stderr: string
}

function cwdAncestorCandidates(maxLevels = 4): string[] {
  const candidates: string[] = []
  let current = resolve(process.cwd())
  for (let i = 0; i <= maxLevels; i += 1) {
    candidates.push(current)
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return candidates
}

function bundledHermesFromAgentRoot(agentRoot?: string): string | undefined {
  if (!agentRoot) return undefined
  const bundled = resolve(agentRoot, 'hermes')
  return existsSync(bundled) ? bundled : undefined
}

function discoverBundledHermes(): string | undefined {
  const agentRoot = process.env.HERMES_AGENT_ROOT?.trim()
  const fromAgentRoot = bundledHermesFromAgentRoot(agentRoot)
  if (fromAgentRoot) return fromAgentRoot

  for (const candidate of cwdAncestorCandidates()) {
    const bundled = resolve(candidate, 'hermes')
    if (existsSync(bundled)) return bundled
  }

  return undefined
}

export function resolveHermesBin(customBin?: string): string {
  const explicit = customBin?.trim() || process.env.HERMES_BIN?.trim()
  if (explicit) {
    //#region debug-point hermes-process-explicit-bin
    logger.info({ explicit }, '[hermes-process] using explicit Hermes bin')
    //#endregion
    return explicit
  }

  const bundled = discoverBundledHermes()
  if (bundled) {
    //#region debug-point hermes-process-bundled-bin
    logger.info({ requestedAgentRoot: process.env.HERMES_AGENT_ROOT?.trim() || null, bundled }, '[hermes-process] using bundled Hermes launcher')
    //#endregion
    return bundled
  }

  //#region debug-point hermes-process-fallback-bin
  logger.warn({ requestedAgentRoot: process.env.HERMES_AGENT_ROOT?.trim() || null }, '[hermes-process] falling back to PATH Hermes bin')
  //#endregion
  return 'hermes'
}

function pythonForWindowsCli(): string | null {
  const envPython = process.env.HERMES_AGENT_CLI_PYTHON?.trim()
  if (envPython) return envPython

  const bridgePython = process.env.HERMES_AGENT_BRIDGE_PYTHON?.trim()
  if (bridgePython) return bridgePython

  return 'python'
}

function bundledCliPythonForWindows(hermesBin: string): string | null {
  if (basename(hermesBin).toLowerCase() !== 'hermes.exe') return null
  const python = resolve(dirname(hermesBin), '..', 'python.exe')
  return existsSync(python) ? python : null
}

function withWindowsHide<T extends ExecFileOptions | SpawnOptions>(options?: T): T {
  if (process.platform !== 'win32') return (options || {}) as T
  return { windowsHide: true, ...(options || {}) } as T
}

export function resolveHermesInvocation(hermesBin = resolveHermesBin()): HermesInvocation {
  if (process.platform === 'win32') {
    const python = bundledCliPythonForWindows(hermesBin)
    if (python) {
      //#region debug-point hermes-process-bundled-python
      logger.info({ hermesBin, python }, '[hermes-process] using bundled Windows CLI Python')
      //#endregion
      return { command: python, argsPrefix: ['-m', 'hermes_cli.main'] }
    }

    const baseName = basename(hermesBin).toLowerCase()
    if (baseName === 'hermes' && existsSync(hermesBin)) {
      const cliPython = pythonForWindowsCli()
      if (cliPython) {
        //#region debug-point hermes-process-script-python
        logger.info({ hermesBin, cliPython }, '[hermes-process] using script-based Hermes launcher with selected Python')
        //#endregion
        return { command: cliPython, argsPrefix: [hermesBin] }
      }
    }
  }

  //#region debug-point hermes-process-direct-bin
  logger.info({ hermesBin }, '[hermes-process] invoking Hermes bin directly')
  //#endregion
  return { command: hermesBin, argsPrefix: [] }
}

export function execHermesWithBin(
  hermesBin: string,
  args: readonly string[],
  options?: ExecFileOptions,
): Promise<HermesExecResult> {
  const invocation = resolveHermesInvocation(hermesBin)
  return new Promise((resolveExec, rejectExec) => {
    execFile(
      invocation.command,
      [...invocation.argsPrefix, ...args],
      { ...withWindowsHide(options), encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          rejectExec(Object.assign(error, { stdout, stderr }))
          return
        }
        resolveExec({ stdout: String(stdout || ''), stderr: String(stderr || '') })
      },
    )
  })
}

export function execHermes(args: readonly string[], options?: ExecFileOptions) {
  return execHermesWithBin(resolveHermesBin(), args, options)
}

export function spawnHermesWithBin(
  hermesBin: string,
  args: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  const invocation = resolveHermesInvocation(hermesBin)
  return spawn(invocation.command, [...invocation.argsPrefix, ...args], withWindowsHide(options))
}

export function spawnHermes(args: readonly string[], options?: SpawnOptions): ChildProcess {
  return spawnHermesWithBin(resolveHermesBin(), args, options)
}
