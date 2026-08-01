// ============================================================
// WHATSAPP WORKER CONTROL
// Admin panel process control for the standalone Playwright
// WhatsApp worker (scripts/whatsapp-worker.mjs), which is started
// with `npm run whatsapp-worker` (package.json "whatsapp-worker").
//
//   - start   : spawn the worker (no duplicate processes)
//   - stop    : kill the worker + its browser children
//   - restart : stop then start
//   - status  : merge live process state + worker status file
//
// The worker script itself is never modified. It keeps writing its
// own status to storage/worker-status.json; control metadata (pid /
// started_at / last_action) is stored in storage/worker-control.json.
// ============================================================

import { spawn, exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const STORAGE_DIR = path.join(ROOT, 'storage')
const CONTROL_FILE = path.join(STORAGE_DIR, 'worker-control.json')
const STATUS_FILE = path.join(STORAGE_DIR, 'worker-status.json')
const LOG_FILE = path.join(STORAGE_DIR, 'whatsapp-worker.log')
const WORKER_SCRIPT = path.join(ROOT, 'scripts', 'whatsapp-worker.mjs')

export interface WorkerControlState {
  pid: number | null
  started_at: string | null
  last_action: 'start' | 'stop' | 'restart' | null
}

export interface WorkerRuntimeStatus extends WorkerControlState {
  running: boolean
  connected: boolean
  qr_pending: boolean
  agent_enabled: boolean
  last_ping: string | null
  last_error: string | null
  worker_pids: number[]
}

const EMPTY_CONTROL: WorkerControlState = { pid: null, started_at: null, last_action: null }

// ── Control file (server-owned metadata) ──
function readControl(): WorkerControlState {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTROL_FILE, 'utf-8'))
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : null,
      started_at: typeof parsed.started_at === 'string' ? parsed.started_at : null,
      last_action: ['start', 'stop', 'restart'].includes(parsed.last_action) ? parsed.last_action : null,
    }
  } catch {
    return { ...EMPTY_CONTROL }
  }
}

function writeControl(patch: Partial<WorkerControlState>): void {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
    fs.writeFileSync(CONTROL_FILE, JSON.stringify({ ...readControl(), ...patch }, null, 2))
  } catch {
    // best-effort — process state is still detected from the OS
  }
}

// ── Worker status file (written by scripts/whatsapp-worker.mjs) ──
function readWorkerStatusFile() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

// ── Process detection ──
function execPids(cmd: string): Promise<number[]> {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      const pids = stdout
        .split(/[\r\n]+/)
        .map((l) => Number.parseInt(l.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
      resolve(pids)
    })
  })
}

// Find every running process whose command line references the worker script.
// The `[.]` trick stops the search command from matching itself.
export function findWorkerPids(): Promise<number[]> {
  if (process.platform === 'win32') {
    return execPids(
      'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'whatsapp-worker[.]mjs\' } | Select-Object -ExpandProperty ProcessId"'
    )
  }
  return execPids("ps -eo pid=,command= | grep 'whatsapp-worker\\.mjs' | grep -v grep | awk '{print $1}'")
}

// Find any Chromium browser still bound to the worker's profile directory
// (command line contains the whatsapp-session user-data-dir).
function findOrphanedBrowserPids(): Promise<number[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return execPids(
    'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'chrome.exe\' -and $_.CommandLine -match \'whatsapp-session\' } | Select-Object -ExpandProperty ProcessId"'
  )
}

function isPidAlive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

// A previous run can leave either a live Chromium process or stale Singleton*
// / DevToolsActivePort lock files behind. Both cause the next launch to fail
// with "Opening in existing browser session" — Playwright does not clean these
// up, so we do before every spawn.
async function prepareSessionForLaunch(): Promise<void> {
  const orphaned = await findOrphanedBrowserPids()
  for (const pid of orphaned) {
    await killProcessTree(pid)
  }

  const sessionDir = process.env.WHATSAPP_SESSION_DIR || path.join(STORAGE_DIR, 'whatsapp-session')
  const names = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'Singleton', 'DevToolsActivePort']
  for (const name of names) {
    try {
      fs.rmSync(path.join(sessionDir, name), { force: true })
    } catch {
      // best-effort — a lock that is genuinely in use will simply fail the launch
    }
  }
}

function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    if (process.platform === 'win32') {
      exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, () => done())
    } else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
      done()
    }
    setTimeout(done, 4000).unref?.()
  })
}

// ── Public API ──

// Resets the worker's own status file to a clean slate before a (re)start, so a
// stale last-error from a previous run is not shown against the fresh process.
// The worker merges its updates over this file, so this is safe to do pre-spawn.
function resetWorkerStatusFile(): void {
  try {
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify(
        {
          connected: false,
          lastError: null,
          lastPing: null,
          qrPending: false,
          lastIncoming: {},
          agentEnabled: false,
        },
        null,
        2
      )
    )
  } catch {
    // best-effort
  }
}

export function getWorkerStatus(): Promise<WorkerRuntimeStatus> {
  return findWorkerPids().then((workerPids) => {
    const control = readControl()
    const file = readWorkerStatusFile()
    const running = workerPids.length > 0 || isPidAlive(control.pid)

    return {
      running,
      connected: !!file.connected,
      qr_pending: !!file.qrPending,
      agent_enabled: !!file.agentEnabled,
      last_ping: file.lastPing ?? null,
      last_error: file.lastError ?? null,
      pid: workerPids[0] ?? control.pid,
      started_at: control.started_at,
      last_action: control.last_action,
      worker_pids: workerPids,
    }
  })
}

export async function startWorker(): Promise<{ ok: boolean; alreadyRunning: boolean; pid: number | null; error?: string }> {
  const workerPids = await findWorkerPids()
  if (workerPids.length > 0 || isPidAlive(readControl().pid)) {
    return { ok: true, alreadyRunning: true, pid: workerPids[0] ?? readControl().pid }
  }

  if (!fs.existsSync(WORKER_SCRIPT)) {
    return { ok: false, alreadyRunning: false, pid: null, error: `Worker script not found: ${WORKER_SCRIPT}` }
  }

  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
    await prepareSessionForLaunch()
    resetWorkerStatusFile()
    const out = fs.openSync(LOG_FILE, 'a')
    // Equivalent to `npm run whatsapp-worker` (package.json maps it to
    // `node scripts/whatsapp-worker.mjs`). Spawning node directly avoids npm
    // opening a new console on Windows, which would hijack stdout and break
    // log capture. The worker loads .env.local itself.
    const child = spawn(process.execPath, [WORKER_SCRIPT], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    child.unref()

    const pid = child.pid ?? null
    writeControl({ pid, started_at: new Date().toISOString(), last_action: 'start' })
    return { ok: true, alreadyRunning: false, pid }
  } catch (e) {
    return { ok: false, alreadyRunning: false, pid: null, error: (e as Error).message }
  }
}

export async function stopWorker(): Promise<{ ok: boolean; wasRunning: boolean; stoppedPids: number[] }> {
  const workerPids = await findWorkerPids()
  const control = readControl()
  const targets = new Set(workerPids)
  if (control.pid && isPidAlive(control.pid)) targets.add(control.pid)

  const stopped: number[] = []
  for (const pid of targets) {
    await killProcessTree(pid)
    stopped.push(pid)
  }

  writeControl({ pid: null, last_action: 'stop' })
  return { ok: true, wasRunning: targets.size > 0, stoppedPids: stopped }
}

export async function restartWorker(): Promise<{ ok: boolean; pid: number | null; error?: string }> {
  const stopResult = await stopWorker()
  // Give the browser a moment to fully release its session directory locks.
  if (stopResult.wasRunning) {
    await new Promise((r) => setTimeout(r, 1500))
  }
  const started = await startWorker()
  if (!started.ok) return { ok: false, pid: null, error: started.error }
  return { ok: true, pid: started.pid }
}
