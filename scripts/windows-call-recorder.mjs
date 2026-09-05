import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import 'dotenv/config'

const ROOT = process.cwd()
const SESSION_DIR = path.resolve(process.env.CALL_CAPTURE_SESSION_DIR || 'storage/call-capture')
const API_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.WHATSAPP_APP_URL || 'http://localhost:3000'
const DEVICE = process.env.CALL_CAPTURE_AUDIO_DEVICE || ''
const SYSTEM_DEVICE = process.env.CALL_CAPTURE_SYSTEM_DEVICE || ''
const MIC_DEVICE = process.env.CALL_CAPTURE_MIC_DEVICE || ''
const SECRET = process.env.CALL_RECORDING_WEBHOOK_SECRET || ''
const MAX_DURATION_SECONDS = Number(process.env.CALL_CAPTURE_MAX_DURATION_SECONDS || 7200)
const CONTROL_PORT = Number(process.env.CALL_CAPTURE_CONTROL_PORT || 39123)
const activeSessions = new Map()

function usage() {
  console.log('Usage:')
  console.log('  npm run call-recorder -- list-devices')
  console.log('  npm run call-recorder -- daemon')
  console.log('  npm run call-recorder -- start <call-id>')
  console.log('  npm run call-recorder -- stop <session-id>')
}

function requireFfmpeg() {
  if (!ffmpegPath) throw new Error('FFmpeg binary is unavailable. Reinstall dependencies.')
  if (process.platform !== 'win32') throw new Error('This recorder currently supports Windows DirectShow only.')
}

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
}

function sessionFile(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.json`)
}

function runFfmpeg(args, stdio = ['ignore', 'pipe', 'pipe']) {
  return spawn(ffmpegPath, args, { windowsHide: true, stdio })
}

async function listDevices() {
  requireFfmpeg()
  await new Promise((resolve, reject) => {
    const child = runFfmpeg(['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'])
    let output = ''
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.on('error', reject)
    child.on('close', () => {
      process.stdout.write(output)
      resolve()
    })
  })
}

async function start(callId) {
  requireFfmpeg()
  if (!/^[0-9a-f-]{36}$/i.test(callId || '')) throw new Error('A valid call UUID is required')
  if (!DEVICE && (!SYSTEM_DEVICE || !MIC_DEVICE)) {
    throw new Error('Configure CALL_CAPTURE_AUDIO_DEVICE, or configure both CALL_CAPTURE_SYSTEM_DEVICE and CALL_CAPTURE_MIC_DEVICE.')
  }

  ensureSessionDir()
  const sessionId = crypto.randomUUID()
  const outputPath = path.join(SESSION_DIR, `${sessionId}.webm`)
  const captureArgs = DEVICE
    ? ['-f', 'dshow', '-i', `audio=${DEVICE}`]
    : [
        '-f', 'dshow', '-i', `audio=${SYSTEM_DEVICE}`,
        '-f', 'dshow', '-i', `audio=${MIC_DEVICE}`,
        '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2[a]',
        '-map', '[a]',
      ]
  const child = runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    ...captureArgs,
    '-c:a', 'libopus', '-b:a', '128k',
    '-t', String(MAX_DURATION_SECONDS),
    '-y', outputPath,
  ], ['pipe', 'ignore', 'pipe'])

  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  const session = {
    sessionId,
    callId,
    outputPath,
    startedAt: new Date().toISOString(),
    pid: child.pid,
  }
  fs.writeFileSync(sessionFile(sessionId), JSON.stringify(session, null, 2))
  activeSessions.set(sessionId, { child, session })
  child.on('close', (code) => {
    if (code !== 0 && fs.existsSync(sessionFile(sessionId))) {
      fs.writeFileSync(sessionFile(sessionId), JSON.stringify({ ...session, error: stderr.trim() || `FFmpeg exited with ${code}` }, null, 2))
    }
  })
  console.log(JSON.stringify({ ok: true, sessionId, callId, startedAt: session.startedAt, provider: 'windows_dshow_ffmpeg' }))
}

async function stop(sessionId) {
  requireFfmpeg()
  const file = sessionFile(sessionId)
  if (!fs.existsSync(file)) throw new Error('Recording session not found')
  const session = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!fs.existsSync(session.outputPath)) throw new Error('Recording audio file is missing')

  const active = activeSessions.get(sessionId)
  if (!active) throw new Error('Recording daemon does not own this session; stop it through the same daemon process')
  active.child.stdin.write('q\n')
  await new Promise((resolve) => active.child.once('close', resolve))

  // FFmpeg flushes the WebM container on graceful shutdown. Poll briefly and
  // refuse upload if the file is still missing or zero-byte.
  let size = 0
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    try { size = fs.statSync(session.outputPath).size } catch { size = 0 }
    if (size > 0) break
  }
  if (size <= 0) throw new Error('Recording stopped without a non-empty audio file')
  if (!SECRET) throw new Error('CALL_RECORDING_WEBHOOK_SECRET is not configured')

  const body = new FormData()
  body.append('file', new Blob([fs.readFileSync(session.outputPath)], { type: 'audio/webm' }), `${session.sessionId}.webm`)
  const response = await fetch(`${API_BASE_URL}/api/calls/${session.callId}/recording/provider`, {
    method: 'POST',
    headers: { 'x-call-recording-secret': SECRET },
    body,
  })
  if (!response.ok) throw new Error(`ERP recording upload failed: ${response.status} ${await response.text()}`)

  fs.writeFileSync(file, JSON.stringify({ ...session, endedAt: new Date().toISOString(), sizeBytes: size, uploaded: true }, null, 2))
  activeSessions.delete(sessionId)
  console.log(JSON.stringify({ ok: true, sessionId, callId: session.callId, sizeBytes: size, uploaded: true }))
}

async function requestDaemon(pathname, payload) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: CONTROL_PORT, path: pathname, method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk.toString() })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) reject(new Error(body || `Recorder daemon returned ${response.statusCode}`))
        else resolve(body)
      })
    })
    request.on('error', () => reject(new Error(`Recorder daemon is not running on port ${CONTROL_PORT}`)))
    request.end(JSON.stringify(payload))
  })
}

function runDaemon() {
  const server = http.createServer(async (request, response) => {
    try {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const payload = body ? JSON.parse(body) : {}
      if (request.method !== 'POST') throw new Error('POST required')
      if (request.url === '/start') await start(payload.callId)
      else if (request.url === '/stop') await stop(payload.sessionId)
      else throw new Error('Unknown recorder command')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Recorder failed' }))
    }
  })
  server.listen(CONTROL_PORT, '127.0.0.1', () => console.log(`[call-recorder] daemon listening on 127.0.0.1:${CONTROL_PORT}`))
}

const [command, value] = process.argv.slice(2)
try {
  if (command === 'list-devices') await listDevices()
  else if (command === 'daemon') runDaemon()
  else if (command === 'start') console.log(await requestDaemon('/start', { callId: value }))
  else if (command === 'stop') console.log(await requestDaemon('/stop', { sessionId: value }))
  else usage()
} catch (error) {
  console.error(`[call-recorder] ${error instanceof Error ? error.message : 'Recorder failed'}`)
  process.exitCode = 1
}
