// Wiring. Modes via ?view=
//   dual (default)  participant view + Director Desk side panel, one page
//   participant     participant view only (e.g. in a VR headset); a separate Desk drives it
//   desk            Director Desk only; talks to the participant view over a transport
// Other flags:
//   ?session=CODE   pairs a participant view and a Desk
//   ?relay=wss://…  use the WebSocket relay (different devices). Default: VITE_RELAY_URL, else same-browser channel
//   ?fast           short line timings (automated tests)
//   ?vrui           show the in-world VR panels on desktop (preview/testing)
//   ?fps            show a frame-time readout in VR
import './ui/styles.css';
import { SessionStore } from './core/store';
import { diffScene } from './core/snapshot';
import { ANCHOR_ID } from './core/scenario';
import { makeTransport, newSessionCode, type Msg } from './core/transport';
import type { EventEnvelope, EventType, Session } from './core/types';
import { DirectorDesk, type DeskPort } from './ui/desk';
import { h } from './ui/dom';
import { ParticipantUI } from './ui/participant';
import { SceneView } from './view3d/sceneView';
import { VRUI } from './vr/vrui';
import { XRSupport, vrSupported } from './vr/xr';

const params = new URLSearchParams(location.search);
const mode = (params.get('view') ?? 'dual') as 'dual' | 'participant' | 'desk';
const fast = params.has('fast');
const relayUrl = params.get('relay') || (import.meta.env.VITE_RELAY_URL as string | undefined) || null;
const HB_TIMEOUT_MS = relayUrl ? 4000 : 2000;

type Last = { type: EventType; accepted: boolean; reason?: string; actor: string } | null;
type R3 = { status: 'pending' | 'pass' | 'fail' | 'n/a'; diffs: string[] };

const app = document.getElementById('app')!;
document.body.dataset.mode = mode;

if (mode === 'desk') startDeskWindow();
else startParticipant();

function sessionFromUrl(createIfMissing: boolean): string | null {
  let s = params.get('session');
  if (!s && createIfMissing) {
    s = mode === 'participant' && relayUrl ? newSessionCode() : 'demo-001';
    params.set('session', s);
    history.replaceState(null, '', `?${params.toString()}`);
  }
  return s;
}

/** Keep relayed state small: the Desk only needs the recent log. */
function compact(s: Session): Session {
  return { ...s, log: s.log.slice(-30), seenEventIds: [] };
}

function startParticipant() {
  const sessionId = sessionFromUrl(true)!;
  const store = new SessionStore({ sessionId, fast, idPrefix: 'evt' });
  const enterVR = h('button', { class: 'btn primary enter-vr', 'data-testid': 'enter-vr', hidden: true }, 'Enter VR');
  const header = h(
    'header',
    { class: 'app-head' },
    h('strong', {}, 'Therapeutic Realms · The Living Scene'),
    h('span', {}, 'Research prototype · not clinically validated'),
    h('span', { class: 'session-code', 'data-testid': 'session-code' }, `Session ${sessionId}`),
  );
  const pHost = h('div', { class: 'participant', id: 'participant', 'data-testid': 'participant-view' });
  const pWrap = h('section', { class: 'participant-wrap', 'aria-label': 'Participant view' }, h('div', { class: 'frame-label' }, 'Participant view'), pHost);
  const deskHost = h('aside', { class: 'desk-host', 'aria-label': 'Director Desk', 'data-testid': 'desk' });
  const main = h('main', { class: mode === 'dual' ? 'dual' : 'solo' }, pWrap, mode === 'dual' ? deskHost : null);
  app.append(header, main);

  let desk: DirectorDesk | null = null;
  let baseline3D: Record<string, unknown> | null = null;
  let restore3D: R3 = { status: 'n/a', diffs: [] };
  const deskListeners: Array<(s: Session, last: Last) => void> = [];
  const emitDesk = (last: Last) => deskListeners.forEach((fn) => fn(store.session, last));

  const strip = (i: ReturnType<SceneView['inspect']>) => {
    const { settled: _a, ...alex } = i.alex;
    void _a;
    return { camera: i.camera, alex, lights: i.lights, panels: i.panels, ring: i.ring, landmarks: i.landmarks };
  };

  const view = new SceneView(pHost, {
    onPanelClick: (id) => ui.onPanel(id),
    onFrame: (v) => {
      ui.frame();
      if (desk && v.frameCount % 6 === 0) desk.drawPreview();
      const ph = store.session.phase;
      if (ph === 'HELD' && !baseline3D) {
        const i = v.inspect();
        if (i.settled) baseline3D = strip(i);
      }
      if (ph === 'RECOMPOSED' && restore3D.status === 'pending') {
        const i = v.inspect();
        if (i.settled) {
          const diffs = diffScene(baseline3D, strip(i), '3d');
          restore3D = { status: diffs.length ? 'fail' : 'pass', diffs };
          emitDesk(null);
          postState();
        }
      }
    },
  });
  store.animTimeProvider = () => view.alex.animTime;

  const participantSend = (type: EventType, payload?: Record<string, unknown>) => store.send('participant', type, payload);
  const ui = new ParticipantUI(pHost, view, { send: participantSend });

  // ---- VR ----
  const xr = new XRSupport(view, {
    onSqueeze: () => {
      const s = store.session;
      if (['CONVERSATION', 'HELD', 'UNFOLDED', 'EXPLORING', 'RECOMPOSED'].includes(s.phase) && !s.participantPaused) participantSend('PAUSE');
    },
    onSessionChange: (on) => {
      document.body.classList.toggle('in-vr', on);
      vrui.setActive(on || params.has('vrui'));
    },
  });
  const vrui = new VRUI(view, { send: participantSend, exitVR: () => void xr.exit() }, params.has('fps'));
  vrui.setActive(params.has('vrui'));
  if (params.has('vrui')) {
    // Desktop preview of the headset UI: widen the view toward a headset's field of view.
    document.body.classList.add('vrui-preview');
    view.camera.fov = 82;
    view.camera.updateProjectionMatrix();
  }
  pHost.append(enterVR);
  enterVR.addEventListener('click', () => xr.enter().catch((e) => alert(`Could not start VR: ${e?.message ?? e}`)));
  void vrSupported().then((ok) => (enterVR.hidden = !ok));

  let prevPhase = store.session.phase;
  store.subscribe((s, last) => {
    view.apply(s.scene, s.settings, s.selection);
    ui.update(s);
    vrui.update(s);
    if (s.phase !== prevPhase) {
      if (s.phase === 'RECOMPOSED') restore3D = baseline3D ? { status: 'pending', diffs: [] } : { status: 'n/a', diffs: [] };
      else if (s.phase !== 'REFLECTION') restore3D = { status: 'n/a', diffs: [] };
      prevPhase = s.phase;
    }
    emitDesk(last ? { type: last.env.type, accepted: last.result.accepted, reason: last.result.reason, actor: last.env.actor } : null);
  });

  // ---- remote Desk bridge (same browser, or another device via relay) ----
  const transport = makeTransport(sessionId, relayUrl);
  let remoteAttached = false;
  let lastHb = 0;
  let lastPosted = 0;
  function postState() {
    transport.post({ t: 'state', session: compact(store.session), restore3D });
    lastPosted = performance.now();
  }
  store.subscribe(() => postState());
  transport.onMessage((m: Msg) => {
    if (m.t === 'hello' || m.t === 'hb') {
      lastHb = performance.now();
      if (!remoteAttached) {
        remoteAttached = true;
        if (mode === 'dual') {
          deskHost.replaceChildren(h('div', { class: 'desk-moved' }, h('h2', {}, 'Director Desk'), h('p', {}, 'Opened in a separate window or device. Closing it counts as a lost link.')));
          desk = null;
        }
      }
      if (m.t === 'hello') postState();
    } else if (m.t === 'cmd') {
      const env = m.env as EventEnvelope;
      if (env.type === 'HOLD') env.payload = { ...env.payload, animTime: view.alex.animTime };
      const r = store.dispatchEnvelope(env);
      transport.post({ t: 'result', type: env.type, accepted: r.accepted, reason: r.reason, actor: env.actor });
    }
  });
  setInterval(() => {
    if (remoteAttached && store.session.clinicianConnected && performance.now() - lastHb > HB_TIMEOUT_MS) {
      store.send('system', 'DISCONNECT');
    }
    if (performance.now() - lastPosted > 2000) postState();
  }, 500);

  if (mode === 'dual') {
    const port: DeskPort = {
      subscribe: (fn) => {
        deskListeners.push(fn);
        fn(store.session, null);
      },
      send: (type, payload) => store.send('clinician', type, payload),
      dropLink: () => store.send('system', 'DISCONNECT'),
      resendLast: () => store.resendLast(),
      sendAs: (actor, type, payload) => store.dispatchEnvelope(store.envelope(actor, type, payload)),
      openSeparate: () => window.open(`?view=desk&session=${encodeURIComponent(sessionId)}${relayUrl ? `&relay=${encodeURIComponent(relayUrl)}` : ''}`, 'director-desk', 'width=460,height=900'),
      previewCanvas: () => view.renderer.domElement,
      restore3D: () => restore3D,
    };
    desk = new DirectorDesk(deskHost, port);
  }

  // Hooks for automated tests and manual inspection in the console.
  (window as unknown as { __tr: unknown }).__tr = {
    store,
    view,
    vrui,
    session: () => store.session,
    inspect: () => view.inspect(),
    restore3D: () => restore3D,
    baseline3D: () => baseline3D,
    anchorId: ANCHOR_ID,
    transport: transport.kind,
  };
}

function startDeskWindow() {
  const sessionId = sessionFromUrl(false);
  const host = h('aside', { class: 'desk-host solo-desk', 'data-testid': 'desk' });
  const status = h('p', { class: 'desk-status', 'data-testid': 'desk-window-status' }, 'Looking for the participant view…');
  app.append(h('header', { class: 'app-head' }, h('strong', {}, 'Director Desk'), h('span', {}, `Clinician only · ${relayUrl ? 'relay link' : 'same-browser link'}`)), status, host);

  if (!sessionId) {
    // Ask for the code shown in the participant's Waiting screen.
    const input = h('input', { type: 'text', 'aria-label': 'Session code', placeholder: 'Session code', 'data-testid': 'desk-code', autocomplete: 'off' });
    const form = h(
      'form',
      { class: 'code-form', onsubmit: (e: Event) => {
        e.preventDefault();
        const code = input.value.trim().toUpperCase();
        if (!code) return;
        params.set('session', code);
        location.search = params.toString();
      } },
      h('h2', {}, 'Join a session'),
      h('p', {}, 'Enter the code shown on the participant’s Waiting screen (or in the page header).'),
      input,
      h('button', { class: 'btn desk-btn', type: 'submit' }, 'Join'),
    );
    status.textContent = '';
    host.append(form);
    input.focus();
    return;
  }

  const transport = makeTransport(sessionId, relayUrl);
  let session: Session | null = null;
  let counter = 0;
  let linkDropped = false;
  let lastEnv: EventEnvelope | null = null;
  let lastState = 0;
  const listeners: Array<(s: Session, last: Last) => void> = [];
  let pendingLast: Last = null;
  let r3: R3 = { status: 'n/a', diffs: [] };
  let netStatus = 'connecting';
  transport.onStatus((s) => {
    netStatus = s;
    if (s === 'open') transport.post({ t: 'hello' });
  });

  const refreshStatus = () => {
    const seen = performance.now() - lastState < 5000;
    status.textContent = linkDropped
      ? 'Link deliberately dropped (heartbeat stopped).'
      : netStatus !== 'open'
        ? `Relay ${netStatus}…`
        : seen
          ? `Connected to participant view · session ${sessionId}`
          : `Waiting for participant view with session ${sessionId}…`;
  };
  transport.onMessage((m: Msg) => {
    if (m.t === 'state') {
      session = m.session as Session;
      r3 = (m.restore3D as R3) ?? r3;
      lastState = performance.now();
      refreshStatus();
      listeners.forEach((fn) => fn(session!, pendingLast));
      pendingLast = null;
    } else if (m.t === 'result') {
      pendingLast = { type: m.type as EventType, accepted: !!m.accepted, reason: m.reason as string | undefined, actor: String(m.actor) };
    }
  });
  const post = (env: EventEnvelope) => {
    lastEnv = env;
    transport.post({ t: 'cmd', env });
  };
  const build = (actor: 'clinician' | 'participant' | 'system', type: EventType, payload?: Record<string, unknown>): EventEnvelope => {
    counter += 1;
    const env: EventEnvelope = {
      sessionId,
      eventId: `desk-${Date.now().toString(36)}-${counter}`,
      actor,
      type,
      timestampMs: Math.round(performance.now()),
      payload,
    };
    if (session && actor === 'clinician' && type !== 'CONNECT' && type !== 'END') env.stateExpected = session.phase;
    if (type === 'HOLD' || type === 'UNFOLD' || type === 'RECOMPOSE') env.anchorId = ANCHOR_ID;
    return env;
  };
  transport.post({ t: 'hello' });
  setInterval(() => {
    if (!linkDropped) transport.post({ t: 'hb' });
    refreshStatus();
  }, 500);

  const port: DeskPort = {
    subscribe: (fn) => {
      listeners.push(fn);
    },
    send: (type, payload) => {
      if (type === 'CONNECT') {
        linkDropped = false;
        transport.post({ t: 'hb' });
      }
      post(build('clinician', type, payload));
    },
    dropLink: () => {
      linkDropped = true;
      refreshStatus();
    },
    resendLast: () => lastEnv && transport.post({ t: 'cmd', env: lastEnv }),
    sendAs: (actor, type, payload) => post(build(actor, type, payload)),
    restore3D: () => r3,
  };
  new DirectorDesk(host, port);
}
