// SessionStateMachine — a pure function: (session, event) → new session + accepted/rejected.
// No timers, no DOM, no 3D. That keeps it fully testable.
//
// Simple picture: this file is the rulebook. Every button press arrives as a
// signed note ("who, what, when"). The rulebook either says "allowed" and
// writes down the new situation, or says "not allowed, because…" and changes nothing.

import { ANCHOR_ID, BRANCHES, CONVERSATION, M01_INDEX, ORIGINAL_LINE, SCENARIO_ID } from './scenario';
import { restoreScene, takeSnapshot } from './snapshot';
import type {
  Actor,
  BranchId,
  DispatchResult,
  EventEnvelope,
  EventType,
  Phase,
  SceneState,
  Session,
  Settings,
} from './types';

export const LIVE_PHASES: readonly Phase[] = ['CONVERSATION', 'HELD', 'UNFOLDED', 'EXPLORING', 'RECOMPOSED'];
export const TERMINAL_PHASES: readonly Phase[] = ['ENDED', 'LEFT'];

/** The participant's seat. Never changed by any event. */
export const FIXED_CAMERA = Object.freeze({
  position: Object.freeze([0, 1.12, 2.35]) as unknown as [number, number, number],
  target: Object.freeze([0, 1.02, -0.7]) as unknown as [number, number, number],
});

const ACTORS: Record<EventType, Actor> = {
  ENTER: 'participant',
  SAVE_SETTINGS: 'participant',
  ACKNOWLEDGE: 'participant',
  CONTINUE: 'participant',
  READY: 'participant',
  PAUSE: 'participant',
  RESUME: 'participant',
  SELECT: 'participant',
  DESELECT: 'participant',
  REQUEST_RETURN: 'participant',
  LEAVE: 'participant',
  CONNECT: 'clinician',
  START: 'clinician',
  HOLD: 'clinician',
  UNFOLD: 'clinician',
  BEGIN_BRANCH: 'clinician',
  RECOMPOSE: 'clinician',
  RESUME_SESSION: 'clinician',
  REFLECT: 'clinician',
  END: 'clinician',
  DISCONNECT: 'system',
  ADVANCE: 'system',
};

export const DEFAULT_SETTINGS: Settings = {
  captions: true,
  captionSize: 'M',
  reducedMotion: false,
  highContrast: false,
  volume: 0.6,
  voice: false,
};

export function initialScene(): SceneState {
  return {
    caption: null,
    alex: { pose: 'idle', animTime: 0, position: [0, 0, -0.75], rotationY: 0 },
    lighting: { key: 1, lamp: 1, peripheralDim: 0, tint: null },
    camera: { position: [...FIXED_CAMERA.position], target: [...FIXED_CAMERA.target] },
    anchor: { ring: false, quote: false },
    panels: { A: false, B: false },
    hypotheticalLabel: null,
  };
}

export function createSession(sessionId = 'demo-001', settings: Partial<Settings> = {}): Session {
  return {
    sessionId,
    scenarioId: SCENARIO_ID,
    phase: 'WELCOME',
    settings: { ...DEFAULT_SETTINGS, ...settings },
    acknowledged: false,
    participantReady: false,
    clinicianConnected: false,
    participantPaused: false,
    linkHalted: false,
    lineIndex: -1,
    m01Reached: false,
    selection: null,
    activeBranch: null,
    branchStep: 0,
    returnRequested: false,
    visited: [],
    snapshot: null,
    scene: initialScene(),
    restoreCount: 0,
    earlyEndJustification: null,
    seenEventIds: [],
    log: [],
  };
}

/** Identifies "where playback is". Timers attach it to ADVANCE so stale timers are rejected. */
export function playbackCursor(s: Session): string {
  return `${s.phase}:${s.lineIndex}:${s.m01Reached}:${s.activeBranch ?? '-'}:${s.branchStep}`;
}

export function isLive(s: Session): boolean {
  return LIVE_PHASES.includes(s.phase);
}

/** Can the scenario move forward on its own right now? */
export function canProgress(s: Session): boolean {
  return s.clinicianConnected && !s.linkHalted && !s.participantPaused;
}

/** Is there a scripted step waiting to play? */
export function hasPendingPlayback(s: Session): boolean {
  if (s.phase === 'CONVERSATION') return !s.m01Reached;
  if (s.phase === 'EXPLORING') return s.branchStep < 2;
  return false;
}

const isBranch = (v: unknown): v is BranchId => v === 'A' || v === 'B';

class Reject extends Error {}
const reject = (reason: string): never => {
  throw new Reject(reason);
};

export function dispatch(prev: Session, ev: EventEnvelope): DispatchResult {
  // Wrong session or replayed event: refuse before anything else, and do not log as seen.
  if (ev.sessionId !== prev.sessionId) {
    return finish(prev, ev, false, `wrong session "${ev.sessionId}"`, false);
  }
  if (prev.seenEventIds.includes(ev.eventId)) {
    return finish(prev, ev, false, `duplicate event ${ev.eventId}`, false);
  }

  const s: Session = structuredClone(prev);
  // structuredClone drops freezing, so keep the original frozen snapshot object.
  s.snapshot = prev.snapshot;

  try {
    const expectedActor = ACTORS[ev.type];
    if (!expectedActor) reject(`unknown event type "${String(ev.type)}"`);
    if (ev.actor !== expectedActor) reject(`${ev.type} must come from ${expectedActor}, not ${ev.actor}`);
    if (ev.stateExpected && ev.stateExpected !== s.phase) {
      reject(`expected state ${ev.stateExpected} but session is ${s.phase}`);
    }
    if (TERMINAL_PHASES.includes(s.phase)) reject(`session already ${s.phase}`);
    if (ev.anchorId && ev.anchorId !== ANCHOR_ID) reject(`unknown anchor ${ev.anchorId}`);

    // Clinician commands need a live link. Reconnecting is the only exception.
    if (ev.actor === 'clinician' && ev.type !== 'CONNECT' && !s.clinicianConnected) {
      reject('clinician is disconnected');
    }
    const clinicianProgression: EventType[] = ['START', 'HOLD', 'UNFOLD', 'BEGIN_BRANCH', 'RECOMPOSE', 'REFLECT'];
    if (clinicianProgression.includes(ev.type)) {
      if (s.linkHalted) reject('session halted after link loss — clinician must Resume Session first');
      if (s.participantPaused) reject('participant has paused — wait for them to resume');
    }

    apply(s, ev);
    return finish(s, ev, true);
  } catch (err) {
    if (err instanceof Reject) {
      const kept = structuredClone(prev);
      kept.snapshot = prev.snapshot;
      return finish(kept, ev, false, err.message);
    }
    throw err;
  }
}

function finish(s: Session, ev: EventEnvelope, accepted: boolean, reason?: string, markSeen = true): DispatchResult {
  if (markSeen && !s.seenEventIds.includes(ev.eventId)) s.seenEventIds = [...s.seenEventIds, ev.eventId];
  s.log = [
    ...s.log,
    { eventId: ev.eventId, actor: ev.actor, type: ev.type, accepted, reason, phase: s.phase, timestampMs: ev.timestampMs },
  ];
  return { session: s, accepted, reason };
}

function need(cond: boolean, reason: string) {
  if (!cond) reject(reason);
}

function needPhase(s: Session, ev: EventType, ...phases: Phase[]) {
  need(phases.includes(s.phase), `${ev} not allowed in ${s.phase}`);
}

function apply(s: Session, ev: EventEnvelope): void {
  const p = ev.payload ?? {};
  switch (ev.type) {
    // ---------- participant: entry ----------
    case 'ENTER':
      needPhase(s, ev.type, 'WELCOME');
      s.phase = 'PREPARE';
      return;

    case 'SAVE_SETTINGS': {
      const next = { ...s.settings };
      if (typeof p.captions === 'boolean') next.captions = p.captions;
      if (p.captionSize === 'S' || p.captionSize === 'M' || p.captionSize === 'L') next.captionSize = p.captionSize;
      if (typeof p.reducedMotion === 'boolean') next.reducedMotion = p.reducedMotion;
      if (typeof p.highContrast === 'boolean') next.highContrast = p.highContrast;
      if (typeof p.voice === 'boolean') next.voice = p.voice;
      if (typeof p.volume === 'number') next.volume = Math.min(1, Math.max(0, p.volume));
      s.settings = next;
      return;
    }

    case 'ACKNOWLEDGE':
      needPhase(s, ev.type, 'PREPARE');
      s.acknowledged = p.value !== false;
      return;

    case 'CONTINUE':
      needPhase(s, ev.type, 'PREPARE');
      need(s.acknowledged, 'participation acknowledgement not checked');
      s.phase = 'WAITING';
      return;

    case 'READY':
      needPhase(s, ev.type, 'WAITING');
      s.participantReady = true;
      return;

    // ---------- participant: safety (never depends on clinician link) ----------
    case 'PAUSE':
      need(isLive(s), `PAUSE not available in ${s.phase}`);
      need(!s.participantPaused, 'already paused');
      s.participantPaused = true;
      return;

    case 'RESUME':
      need(s.participantPaused, 'not paused');
      s.participantPaused = false; // linkHalted (if any) stays until clinician resumes
      return;

    case 'LEAVE':
      s.phase = 'LEFT';
      s.participantPaused = false;
      return;

    // ---------- participant: branch choice ----------
    case 'SELECT':
      needPhase(s, ev.type, 'UNFOLDED');
      need(!s.participantPaused, 'resume before choosing a path');
      need(isBranch(p.branch), 'SELECT needs branch A or B');
      s.selection = p.branch as BranchId;
      return;

    case 'DESELECT':
      needPhase(s, ev.type, 'UNFOLDED');
      s.selection = null;
      return;

    case 'REQUEST_RETURN':
      needPhase(s, ev.type, 'EXPLORING');
      s.returnRequested = true;
      return;

    // ---------- clinician ----------
    case 'CONNECT':
      s.clinicianConnected = true; // does NOT clear linkHalted — explicit resume required
      return;

    case 'DISCONNECT':
      s.clinicianConnected = false;
      if (isLive(s)) s.linkHalted = true;
      return;

    case 'RESUME_SESSION':
      need(s.linkHalted, 'session is not halted');
      s.linkHalted = false;
      return;

    case 'START':
      needPhase(s, ev.type, 'WAITING');
      need(s.acknowledged, 'participant has not acknowledged');
      need(s.participantReady, 'participant is not ready');
      s.phase = 'CONVERSATION';
      s.lineIndex = 0;
      s.m01Reached = false;
      showScriptLine(s);
      return;

    case 'ADVANCE':
      need(isLive(s), `nothing to play in ${s.phase}`);
      need(canProgress(s), 'progression halted (paused or link lost)');
      need(p.cursor === playbackCursor(s), 'stale playback step');
      if (s.phase === 'CONVERSATION') {
        need(!s.m01Reached, 'conversation already at M01');
        if (s.lineIndex < M01_INDEX) {
          s.lineIndex += 1;
          showScriptLine(s);
        } else {
          s.m01Reached = true; // M01 line has finished
          s.scene.alex.pose = 'listening';
        }
        return;
      }
      if (s.phase === 'EXPLORING' && s.activeBranch) {
        const b = BRANCHES[s.activeBranch];
        if (s.branchStep === 0) {
          s.branchStep = 1;
          s.scene.caption = { speaker: 'Alex', text: b.alexLine, kind: 'hypothetical', branch: b.id };
          s.scene.alex.pose = 'speaking';
        } else if (s.branchStep === 1) {
          s.branchStep = 2;
          s.scene.alex.pose = 'listening';
        } else reject('branch already complete');
        return;
      }
      return reject(`nothing to play in ${s.phase}`);

    case 'HOLD': {
      needPhase(s, ev.type, 'CONVERSATION');
      need(s.m01Reached, 'M01 has not finished playing yet');
      need(s.snapshot === null, 'original already captured');
      const animTime = typeof p.animTime === 'number' ? p.animTime : s.scene.alex.animTime;
      s.scene.alex.pose = 'held';
      s.scene.alex.animTime = animTime;
      s.scene.caption = { speaker: 'Alex', text: ORIGINAL_LINE, kind: 'original', branch: null };
      s.scene.anchor = { ring: true, quote: true };
      s.snapshot = takeSnapshot({
        anchorId: ANCHOR_ID,
        scenarioId: s.scenarioId,
        takenAtEventId: ev.eventId,
        lineIndex: s.lineIndex,
        timecodeMs: typeof p.timecodeMs === 'number' ? p.timecodeMs : 0,
        scene: s.scene,
      });
      s.phase = 'HELD';
      return;
    }

    case 'UNFOLD':
      needPhase(s, ev.type, 'HELD', 'RECOMPOSED');
      need(s.snapshot !== null, 'no original moment saved');
      s.scene.panels = { A: true, B: true };
      s.scene.anchor = { ring: true, quote: true };
      s.scene.lighting.peripheralDim = 0.35;
      s.selection = null;
      s.phase = 'UNFOLDED';
      return;

    case 'BEGIN_BRANCH': {
      needPhase(s, ev.type, 'UNFOLDED');
      need(s.selection !== null, 'participant has not selected a path');
      if (p.branch !== undefined) need(p.branch === s.selection, `selected path is ${s.selection}, not ${String(p.branch)}`);
      const b = BRANCHES[s.selection!];
      s.activeBranch = b.id;
      s.branchStep = 0;
      s.returnRequested = false;
      if (!s.visited.includes(b.id)) s.visited = [...s.visited, b.id];
      s.scene.panels = { A: false, B: false };
      s.scene.anchor = { ring: false, quote: false };
      s.scene.hypotheticalLabel = b.id;
      s.scene.lighting.peripheralDim = 0.2;
      s.scene.lighting.tint = b.id;
      s.scene.alex.pose = 'listening';
      s.scene.caption = { speaker: 'You', text: b.participantLine, kind: 'hypothetical', branch: b.id };
      s.phase = 'EXPLORING';
      return;
    }

    case 'RECOMPOSE':
      needPhase(s, ev.type, 'EXPLORING', 'UNFOLDED');
      need(s.snapshot !== null, 'no original moment saved');
      s.scene = restoreScene(s.snapshot!);
      s.selection = null;
      s.activeBranch = null;
      s.branchStep = 0;
      s.returnRequested = false;
      s.restoreCount += 1;
      s.phase = 'RECOMPOSED';
      return;

    case 'REFLECT': {
      needPhase(s, ev.type, 'RECOMPOSED', 'HELD', 'UNFOLDED');
      const why = typeof p.justification === 'string' ? p.justification.trim() : '';
      if (s.visited.length === 0) need(why.length > 0, 'no path explored — an early-end justification is required');
      need(s.phase === 'RECOMPOSED' || why.length > 0, 'Recompose first, or give an early-end justification');
      s.earlyEndJustification = why || null;
      if (s.snapshot) s.scene = restoreScene(s.snapshot);
      s.scene.anchor = { ring: false, quote: false };
      s.selection = null;
      s.phase = 'REFLECTION';
      return;
    }

    case 'END':
      s.phase = 'ENDED';
      s.participantPaused = false;
      return;

    default:
      reject(`unknown event type "${String(ev.type)}"`);
  }
}

function showScriptLine(s: Session) {
  const line = CONVERSATION[s.lineIndex];
  s.scene.caption = {
    speaker: line.speaker,
    text: line.text,
    kind: line.speaker === 'Context' ? 'context' : 'dialogue',
    branch: null,
  };
  s.scene.alex.pose = line.speaker === 'Alex' ? 'speaking' : 'idle';
}

/** Which clinician commands would be accepted right now (for enabling Desk buttons). */
export function clinicianOptions(s: Session) {
  const prog = s.clinicianConnected && !s.linkHalted && !s.participantPaused;
  return {
    START: prog && s.phase === 'WAITING' && s.participantReady && s.acknowledged,
    HOLD: prog && s.phase === 'CONVERSATION' && s.m01Reached && !s.snapshot,
    UNFOLD: prog && (s.phase === 'HELD' || s.phase === 'RECOMPOSED') && !!s.snapshot,
    BEGIN_BRANCH: prog && s.phase === 'UNFOLDED' && s.selection !== null,
    RECOMPOSE: prog && (s.phase === 'EXPLORING' || s.phase === 'UNFOLDED') && !!s.snapshot,
    REFLECT: prog && s.phase === 'RECOMPOSED' && s.visited.length > 0,
    RESUME_SESSION: s.clinicianConnected && s.linkHalted,
    END: s.clinicianConnected && !TERMINAL_PHASES.includes(s.phase),
  };
}
