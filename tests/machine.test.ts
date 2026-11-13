// Unit tests for the state machine. IDs match the manual's acceptance tests (section 17).
import { describe, expect, it } from 'vitest';
import { canProgress, clinicianOptions, createSession, dispatch, playbackCursor } from '../src/core/machine';
import { BRANCHES, ORIGINAL_LINE } from '../src/core/scenario';
import { diffScene } from '../src/core/snapshot';
import type { Actor, EventEnvelope, EventType, Session } from '../src/core/types';

let n = 0;
function ev(actor: Actor, type: EventType, payload?: Record<string, unknown>, extra: Partial<EventEnvelope> = {}): EventEnvelope {
  n += 1;
  return { sessionId: 'demo-001', eventId: `t-${n}`, actor, type, timestampMs: n, payload, ...extra };
}

/** Send an event and assert whether it was accepted. */
function send(s: Session, e: EventEnvelope, expectAccepted = true): Session {
  const r = dispatch(s, e);
  if (r.accepted !== expectAccepted) {
    throw new Error(`${e.type} expected ${expectAccepted ? 'accept' : 'reject'} but got ${r.accepted} (${r.reason})`);
  }
  return r.session;
}

const P = (t: EventType, p?: Record<string, unknown>) => ev('participant', t, p);
const C = (t: EventType, p?: Record<string, unknown>) => ev('clinician', t, p);
const advance = (s: Session) => send(s, ev('system', 'ADVANCE', { cursor: playbackCursor(s) }));

function toWaiting(): Session {
  let s = createSession();
  s = send(s, P('ENTER'));
  s = send(s, P('ACKNOWLEDGE', { value: true }));
  s = send(s, P('CONTINUE'));
  return s;
}

function toM01(): Session {
  let s = toWaiting();
  s = send(s, P('READY'));
  s = send(s, C('CONNECT'));
  s = send(s, C('START'));
  while (!s.m01Reached) s = advance(s);
  return s;
}

function toHeld(): Session {
  return send(toM01(), C('HOLD', { animTime: 3.217, timecodeMs: 2900 }));
}

function explore(s: Session, b: 'A' | 'B'): Session {
  if (s.phase !== 'UNFOLDED') s = send(s, C('UNFOLD'));
  s = send(s, P('SELECT', { branch: b }));
  s = send(s, C('BEGIN_BRANCH'));
  s = advance(s);
  s = advance(s);
  return s;
}

describe('T01 entry', () => {
  it('cannot leave Prepare without acknowledgement', () => {
    let s = send(createSession(), P('ENTER'));
    s = send(s, P('CONTINUE'), false);
    expect(s.phase).toBe('PREPARE');
  });
  it('clinician cannot start before participant Ready', () => {
    let s = send(toWaiting(), C('CONNECT'));
    s = send(s, C('START'), false);
    expect(s.phase).toBe('WAITING');
    s = send(s, P('READY'));
    s = send(s, C('START'));
    expect(s.phase).toBe('CONVERSATION');
  });
  it('participant cannot start the scenario themselves', () => {
    const s = send(toWaiting(), ev('participant', 'START'), false);
    expect(s.phase).toBe('WAITING');
  });
});

describe('T02 start', () => {
  it('rejects START while disconnected, accepts once connected + ready', () => {
    let s = send(toWaiting(), P('READY'));
    s = send(s, C('START'), false);
    expect(s.log.at(-1)?.reason).toMatch(/disconnected/);
    s = send(s, C('CONNECT'));
    s = send(s, C('START'));
    expect(s.phase).toBe('CONVERSATION');
  });
});

describe('T03 canonical line', () => {
  it('is identical in conversation, hold, unfold, restore and reflection', () => {
    let s = toM01();
    expect(s.scene.caption?.text).toBe(ORIGINAL_LINE);
    s = send(s, C('HOLD'));
    expect(s.scene.caption?.text).toBe(ORIGINAL_LINE);
    expect(s.snapshot?.scene.caption?.text).toBe(ORIGINAL_LINE);
    s = send(s, C('UNFOLD'));
    expect(s.scene.caption?.text).toBe(ORIGINAL_LINE);
    s = explore(s, 'A');
    s = send(s, C('RECOMPOSE'));
    expect(s.scene.caption?.text).toBe(ORIGINAL_LINE);
    s = send(s, C('REFLECT'));
    expect(s.scene.caption?.text).toBe(ORIGINAL_LINE);
  });
});

describe('T04 hold', () => {
  it('Hold is rejected before M01 has finished', () => {
    let s = toWaiting();
    s = send(s, P('READY'));
    s = send(s, C('CONNECT'));
    s = send(s, C('START'));
    s = send(s, C('HOLD'), false);
    expect(s.phase).toBe('CONVERSATION');
  });
  it('freezes Alex, saves an immutable snapshot, and shows no branches', () => {
    const s = toHeld();
    expect(s.phase).toBe('HELD');
    expect(s.scene.alex.pose).toBe('held');
    expect(s.scene.alex.animTime).toBe(3.217);
    expect(s.scene.panels).toEqual({ A: false, B: false });
    expect(Object.isFrozen(s.snapshot)).toBe(true);
    expect(Object.isFrozen(s.snapshot!.scene.alex.position)).toBe(true);
    expect(() => {
      (s.snapshot!.scene as { caption: unknown }).caption = null;
    }).toThrow();
    // participant cannot pick a path while held
    send(s, P('SELECT', { branch: 'A' }), false);
  });
});

describe('T05 unfold', () => {
  it('reveals both hypothetical panels while the original stays', () => {
    const s = send(toHeld(), C('UNFOLD'));
    expect(s.scene.panels).toEqual({ A: true, B: true });
    expect(s.scene.anchor.quote).toBe(true);
    expect(s.scene.camera).toEqual(s.snapshot!.scene.camera);
    expect(s.scene.lighting.peripheralDim).toBeLessThan(0.5); // dimmed, never blacked out
  });
});

describe('T06/T07 branches', () => {
  for (const b of ['A', 'B'] as const) {
    it(`path ${b} plays its own scripted lines with a persistent label`, () => {
      let s = send(send(toHeld(), C('UNFOLD')), P('SELECT', { branch: b }));
      s = send(s, C('BEGIN_BRANCH'));
      expect(s.scene.hypotheticalLabel).toBe(b);
      expect(s.scene.caption).toMatchObject({ speaker: 'You', text: BRANCHES[b].participantLine, kind: 'hypothetical', branch: b });
      s = advance(s);
      expect(s.scene.caption).toMatchObject({ speaker: 'Alex', text: BRANCHES[b].alexLine, branch: b });
      expect(s.scene.hypotheticalLabel).toBe(b);
    });
  }
  it('A and B dialogue differ', () => {
    expect(BRANCHES.A.alexLine).not.toBe(BRANCHES.B.alexLine);
    expect(BRANCHES.A.participantLine).not.toBe(BRANCHES.B.participantLine);
  });
});

describe('T08 restore repeat', () => {
  it('A → Recompose → B → Recompose → A → Recompose restores the exact original every time', () => {
    let s = toHeld();
    const saved = s.snapshot!;
    for (const b of ['A', 'B', 'A'] as const) {
      s = explore(s, b);
      expect(diffScene(saved.scene, s.scene).length).toBeGreaterThan(0); // branch really changed things
      s = send(s, C('RECOMPOSE'));
      expect(diffScene(saved.scene, s.scene)).toEqual([]);
      expect(s.snapshot).toBe(saved); // same frozen object, never replaced
      expect(s.selection).toBeNull();
    }
    expect(s.visited).toEqual(['A', 'B']);
    expect(s.restoreCount).toBe(3);
  });
});

describe('T09 safety', () => {
  it('Pause and Leave work in every live state, even disconnected', () => {
    const builders: Array<() => Session> = [
      toM01,
      toHeld,
      () => send(toHeld(), C('UNFOLD')),
      () => explore(toHeld(), 'B'),
      () => send(explore(toHeld(), 'B'), C('RECOMPOSE')),
    ];
    for (const build of builders) {
      let s = build();
      const phase = s.phase;
      s = send(s, ev('system', 'DISCONNECT'));
      s = send(s, P('PAUSE'));
      expect(s.participantPaused).toBe(true);
      s = send(s, P('RESUME'));
      expect(s.phase).toBe(phase); // resumes exactly where it was
      s = send(s, P('PAUSE'));
      s = send(s, P('LEAVE'));
      expect(s.phase).toBe('LEFT');
    }
  });
  it('Leave is available before the session starts', () => {
    expect(send(createSession(), P('LEAVE')).phase).toBe('LEFT');
    expect(send(toWaiting(), P('LEAVE')).phase).toBe('LEFT');
  });
  it('clinician cannot progress while participant is paused', () => {
    let s = send(toHeld(), P('PAUSE'));
    s = send(s, C('UNFOLD'), false);
    expect(s.phase).toBe('HELD');
    s = send(s, P('RESUME'));
    s = send(s, C('UNFOLD'));
    expect(s.phase).toBe('UNFOLDED');
  });
  it('playback does not advance while paused', () => {
    let s = toWaiting();
    s = send(s, P('READY'));
    s = send(s, C('CONNECT'));
    s = send(s, C('START'));
    s = send(s, P('PAUSE'));
    expect(canProgress(s)).toBe(false);
    send(s, ev('system', 'ADVANCE', { cursor: playbackCursor(s) }), false);
  });
});

describe('T10 invalid commands', () => {
  it('rejects wrong state, early Recompose, duplicate Begin and duplicate event ids without corrupting state', () => {
    let s = toM01();
    s = send(s, C('RECOMPOSE'), false); // early: no snapshot
    s = send(s, C('UNFOLD'), false); // wrong state
    s = send(s, C('HOLD'));
    const before = s;
    const dup = C('HOLD');
    s = send(s, dup, false);
    s = send(s, dup, false);
    expect(s.log.at(-1)?.reason).toMatch(/duplicate/);
    expect(s.snapshot).toBe(before.snapshot);
    s = send(s, C('UNFOLD'));
    s = send(s, C('BEGIN_BRANCH'), false); // nothing selected
    s = send(s, P('SELECT', { branch: 'A' }));
    s = send(s, C('BEGIN_BRANCH'));
    s = send(s, C('BEGIN_BRANCH'), false); // duplicate begin
    expect(s.visited).toEqual(['A']);
  });
  it('rejects wrong actor, wrong session, unknown type and stale expected state', () => {
    const s = toHeld();
    send(s, ev('participant', 'UNFOLD'), false);
    send(s, { ...C('UNFOLD'), sessionId: 'other' }, false);
    send(s, ev('clinician', 'TELEPORT' as EventType), false);
    send(s, ev('clinician', 'UNFOLD', undefined, { stateExpected: 'EXPLORING' }), false);
    send(s, ev('clinician', 'UNFOLD', undefined, { anchorId: 'M99' }), false);
    send(s, ev('system', 'ADVANCE', { cursor: 'old' }), false);
  });
});

describe('T11 disconnection', () => {
  it('halts mid-Explore; reconnect alone is not enough; explicit resume continues', () => {
    let s = send(send(send(toHeld(), C('UNFOLD')), P('SELECT', { branch: 'A' })), C('BEGIN_BRANCH'));
    s = send(s, ev('system', 'DISCONNECT'));
    expect(s.linkHalted).toBe(true);
    send(s, ev('system', 'ADVANCE', { cursor: playbackCursor(s) }), false);
    send(s, C('RECOMPOSE'), false);
    s = send(s, C('CONNECT'));
    expect(canProgress(s)).toBe(false);
    send(s, ev('system', 'ADVANCE', { cursor: playbackCursor(s) }), false);
    s = send(s, C('RESUME_SESSION'));
    s = advance(s);
    expect(s.scene.caption?.text).toBe(BRANCHES.A.alexLine);
  });
  it('participant resume does not override a link halt', () => {
    let s = send(toHeld(), ev('system', 'DISCONNECT'));
    s = send(s, P('PAUSE'));
    s = send(s, P('RESUME'));
    expect(s.linkHalted).toBe(true);
    expect(canProgress(s)).toBe(false);
  });
});

describe('T12 reflection', () => {
  it('lists only visited paths, once each', () => {
    let s = toHeld();
    s = send(explore(s, 'B'), C('RECOMPOSE'));
    s = send(explore(s, 'B'), C('RECOMPOSE'));
    s = send(s, C('REFLECT'));
    expect(s.phase).toBe('REFLECTION');
    expect(s.visited).toEqual(['B']);
  });
  it('needs a justification to end early with nothing explored', () => {
    let s = toHeld();
    s = send(s, C('REFLECT'), false);
    s = send(s, C('REFLECT', { justification: 'Participant asked to stop' }));
    expect(s.visited).toEqual([]);
    expect(s.earlyEndJustification).toBe('Participant asked to stop');
  });
});

describe('Director Desk enabling', () => {
  it('only offers commands the machine would accept', () => {
    const s = toHeld();
    const o = clinicianOptions(s);
    expect(o.UNFOLD).toBe(true);
    expect(o.HOLD).toBe(false);
    expect(o.RECOMPOSE).toBe(false);
    for (const [type, enabled] of Object.entries(o)) {
      const r = dispatch(s, C(type as EventType, type === 'REFLECT' ? {} : undefined));
      if (enabled) expect(r.accepted, type).toBe(true);
    }
  });
  it('camera never changes across the whole journey', () => {
    let s = toHeld();
    const cam = JSON.stringify(s.scene.camera);
    s = explore(s, 'A');
    expect(JSON.stringify(s.scene.camera)).toBe(cam);
    s = send(s, C('RECOMPOSE'));
    s = explore(s, 'B');
    expect(JSON.stringify(s.scene.camera)).toBe(cam);
  });
});
