// SessionStore: holds the one live Session, turns button presses into signed
// event envelopes, and runs the script playback timers.
//
// Simple picture: the machine is the rulebook; the store is the referee who
// keeps the scoreboard and the stopwatch.

import { canProgress, createSession, dispatch, hasPendingPlayback, isLive, playbackCursor } from './machine';
import { ANCHOR_ID, CONVERSATION, M01_INDEX, lineDurationMs } from './scenario';
import type { Actor, DispatchResult, EventEnvelope, EventType, Session } from './types';

export type Listener = (s: Session, last: { env: EventEnvelope; result: DispatchResult } | null) => void;

export interface StoreOptions {
  sessionId?: string;
  fast?: boolean; // short timings for automated tests
  idPrefix?: string;
}

export class SessionStore {
  private s: Session;
  private listeners = new Set<Listener>();
  private counter = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerCursor: string | null = null;
  private readonly fast: boolean;
  private readonly prefix: string;
  /** Supplied by the 3D view so HOLD can freeze Alex on the exact frame. */
  animTimeProvider: () => number = () => 0;
  lastEnvelope: EventEnvelope | null = null;

  constructor(opts: StoreOptions = {}) {
    this.s = createSession(opts.sessionId ?? 'demo-001');
    this.fast = !!opts.fast;
    this.prefix = opts.idPrefix ?? 'evt';
  }

  get session(): Session {
    return this.s;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.s, null);
    return () => this.listeners.delete(fn);
  }

  nextEventId(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(5, '0')}`;
  }

  /** Build an envelope for a command. Clinician commands carry the state they expect. */
  envelope(actor: Actor, type: EventType, payload?: Record<string, unknown>): EventEnvelope {
    const env: EventEnvelope = {
      sessionId: this.s.sessionId,
      eventId: this.nextEventId(),
      actor,
      type,
      timestampMs: Math.round(performance.now()),
      payload,
    };
    if (actor === 'clinician' && type !== 'CONNECT' && type !== 'END') env.stateExpected = this.s.phase;
    if (type === 'HOLD' || type === 'RECOMPOSE' || type === 'UNFOLD') env.anchorId = ANCHOR_ID;
    if (type === 'HOLD') {
      env.payload = {
        ...payload,
        animTime: this.animTimeProvider(),
        timecodeMs: lineDurationMs(CONVERSATION[M01_INDEX].text, this.fast),
      };
    }
    return env;
  }

  send(actor: Actor, type: EventType, payload?: Record<string, unknown>): DispatchResult {
    return this.dispatchEnvelope(this.envelope(actor, type, payload));
  }

  dispatchEnvelope(env: EventEnvelope): DispatchResult {
    const result = dispatch(this.s, env);
    this.s = result.session;
    if (env.actor !== 'system') this.lastEnvelope = env;
    this.schedulePlayback();
    for (const fn of this.listeners) fn(this.s, { env, result });
    return result;
  }

  /** Testing aid: re-send the exact last envelope to prove duplicates are rejected. */
  resendLast(): DispatchResult | null {
    return this.lastEnvelope ? this.dispatchEnvelope(this.lastEnvelope) : null;
  }

  private schedulePlayback() {
    const s = this.s;
    const want = isLive(s) && canProgress(s) && hasPendingPlayback(s) ? playbackCursor(s) : null;
    if (want === this.timerCursor) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerCursor = want;
    if (!want) return;
    const text = s.scene.caption?.text ?? '';
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerCursor = null;
      this.send('system', 'ADVANCE', { cursor: want });
    }, lineDurationMs(text, this.fast));
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
