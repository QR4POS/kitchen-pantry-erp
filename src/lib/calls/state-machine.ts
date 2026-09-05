export type CallState =
  | 'detected'
  | 'ringing'
  | 'dialing'
  | 'connected'
  | 'recording'
  | 'ended'
  | 'missed'
  | 'processing'
  | 'completed'
  | 'failed'

export type CallEvent =
  | 'ringing'
  | 'dialing'
  | 'connected'
  | 'recording_started'
  | 'recording_stopped'
  | 'ended'
  | 'missed'
  | 'processing_started'
  | 'completed'
  | 'failed'

export function callEventForStatus(status: string): CallEvent | null {
  if (status === 'ringing' || status === 'dialing' || status === 'connected' || status === 'ended' || status === 'missed') return status
  return null
}

const transitions: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
  detected: { ringing: 'ringing', dialing: 'dialing', connected: 'connected', missed: 'missed' },
  ringing: { ringing: 'ringing', connected: 'connected', missed: 'missed', ended: 'ended' },
  dialing: { dialing: 'dialing', connected: 'connected', missed: 'missed', ended: 'ended' },
  connected: { connected: 'connected', recording_started: 'recording', ended: 'ended', missed: 'missed' },
  recording: { recording_started: 'recording', recording_stopped: 'ended', ended: 'ended' },
  ended: { processing_started: 'processing', ended: 'ended' },
  missed: { missed: 'missed' },
  processing: { completed: 'completed', failed: 'failed', processing_started: 'processing' },
  completed: { completed: 'completed' },
  failed: { failed: 'failed', processing_started: 'processing' },
}

export function transitionCallState(state: CallState, event: CallEvent): CallState {
  const next = transitions[state][event]
  if (!next) throw new Error(`Invalid call transition: ${state} -> ${event}`)
  return next
}

export function canTransitionCallState(state: CallState, event: CallEvent): boolean {
  return Boolean(transitions[state][event])
}