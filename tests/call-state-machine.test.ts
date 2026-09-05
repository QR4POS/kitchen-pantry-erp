import { describe, expect, it } from 'vitest'
import { canTransitionCallState, transitionCallState } from '@/lib/calls/state-machine'

describe('call state machine', () => {
  it('supports the connected recording processing workflow', () => {
    let state = transitionCallState('detected', 'ringing')
    state = transitionCallState(state, 'connected')
    state = transitionCallState(state, 'recording_started')
    state = transitionCallState(state, 'recording_stopped')
    state = transitionCallState(state, 'processing_started')
    state = transitionCallState(state, 'completed')
    expect(state).toBe('completed')
  })

  it('allows unanswered calls to end as missed without recording', () => {
    expect(transitionCallState('dialing', 'missed')).toBe('missed')
    expect(canTransitionCallState('missed', 'recording_started')).toBe(false)
  })

  it('rejects recording before connection and invalid terminal transitions', () => {
    expect(() => transitionCallState('ringing', 'recording_started')).toThrow('Invalid call transition')
    expect(() => transitionCallState('completed', 'processing_started')).toThrow('Invalid call transition')
  })

  it('treats duplicate provider events as idempotent', () => {
    expect(transitionCallState('recording', 'recording_started')).toBe('recording')
    expect(transitionCallState('ended', 'ended')).toBe('ended')
    expect(transitionCallState('completed', 'completed')).toBe('completed')
  })
})