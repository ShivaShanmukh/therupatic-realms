// Participant view: the 3D room plus everything the participant can see and do.
// No clinician controls live in this file.
import { isLive } from '../core/machine';
import { BRANCHES, ORIGINAL_LINE, REFLECTION_QUESTION } from '../core/scenario';
import type { BranchId, EventType, Session } from '../core/types';
import type { SceneView } from '../view3d/sceneView';
import { h, icon } from './dom';

export interface ParticipantPort {
  send: (type: EventType, payload?: Record<string, unknown>) => void;
}

const PHASE_TITLE: Partial<Record<Session['phase'], string>> = {
  CONVERSATION: '04 · The conversation',
  HELD: '05 · Moment held',
  UNFOLDED: '06 · Unfold the scene',
  EXPLORING: '07 · Explore a possibility',
  RECOMPOSED: '08 · Original moment restored',
};

export class ParticipantUI {
  private root: HTMLElement;
  private layer: HTMLElement;
  private screen: HTMLElement;
  private phaseTag: HTMLElement;
  private caption: HTMLElement;
  private quote: HTMLElement;
  private panelLabels: Record<BranchId, HTMLButtonElement>;
  private note: HTMLElement;
  private hypBadge: HTMLElement;
  private safety: HTMLElement;
  private returnBtn: HTMLButtonElement;
  private overlay: HTMLElement;
  private live: HTMLElement;
  private keys: Record<string, string> = {};
  private s: Session | null = null;
  private lastSpoken = '';
  private audio: AudioContext | null = null;

  constructor(host: HTMLElement, private view: SceneView, private port: ParticipantPort) {
    this.root = host;
    this.layer = h('div', { class: 'p-layer' });
    this.phaseTag = h('div', { class: 'phase-tag', 'data-testid': 'phase-tag' });
    this.caption = h('div', { class: 'caption', 'data-testid': 'caption', role: 'region', 'aria-label': 'Captions' });
    this.quote = h('div', { class: 'quote-card', 'data-testid': 'original-quote', role: 'note' });
    this.panelLabels = { A: this.panelButton('A'), B: this.panelButton('B') };
    this.note = h('div', { class: 'state-note', 'data-testid': 'state-note' });
    this.hypBadge = h('div', { class: 'hyp-badge', 'data-testid': 'hyp-badge' });
    this.returnBtn = h(
      'button',
      { class: 'btn ghost return-btn', 'data-testid': 'request-return', onclick: () => this.port.send('REQUEST_RETURN') },
      icon('back'),
      'Request return to the original',
    );
    this.safety = h('div', { class: 'safety', role: 'group', 'aria-label': 'Pause and leave' });
    this.screen = h('div', { class: 'screen-host' });
    this.overlay = h('div', { class: 'overlay-host' });
    this.live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'data-testid': 'announcer' });
    this.layer.append(
      this.phaseTag,
      this.quote,
      this.panelLabels.A,
      this.panelLabels.B,
      this.note,
      this.hypBadge,
      this.caption,
      this.returnBtn,
      this.safety,
      this.screen,
      this.overlay,
      this.live,
    );
    this.root.append(this.layer);

    window.addEventListener('keydown', (e) => {
      if (!this.s) return;
      if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        if (isLive(this.s) && !this.s.participantPaused) {
          e.preventDefault();
          this.port.send('PAUSE');
        }
      }
    });
  }

  private panelButton(id: BranchId): HTMLButtonElement {
    const b = BRANCHES[id];
    return h(
      'button',
      {
        class: `path-label path-${id.toLowerCase()}`,
        'data-testid': `path-${id}`,
        'aria-pressed': 'false',
        onclick: () => this.onPanel(id),
      },
      h('span', { class: 'path-kicker' }, `Hypothetical · Path ${id}`),
      h('span', { class: 'path-title' }, b.label),
      h('span', { class: 'path-sub' }, 'One possible continuation'),
      h('span', { class: 'path-action' }),
    );
  }

  onPanel(id: BranchId) {
    if (!this.s || this.s.phase !== 'UNFOLDED') return;
    this.port.send(this.s.selection === id ? 'DESELECT' : 'SELECT', { branch: id });
  }

  private announce(msg: string) {
    this.live.textContent = '';
    setTimeout(() => (this.live.textContent = msg), 30);
  }

  update(s: Session) {
    const prev = this.s;
    this.s = s;
    const st = s.settings;
    this.root.classList.toggle('hc', st.highContrast);
    this.root.classList.toggle('rm', st.reducedMotion);
    this.root.dataset.captionSize = st.captionSize;
    this.root.dataset.phase = s.phase;

    const live = isLive(s);
    this.phaseTag.textContent = PHASE_TITLE[s.phase] ?? '';
    this.phaseTag.hidden = !PHASE_TITLE[s.phase];

    // Original quote anchored in the room (Hold / Unfold / Recompose)
    const showQuote = s.scene.anchor.quote && live;
    this.quote.hidden = !showQuote;
    if (this.keyChanged('quote', `${showQuote}|${s.phase}`)) {
      this.quote.replaceChildren(
        h('span', { class: 'quote-kicker' }, icon('lock'), s.phase === 'UNFOLDED' ? 'Original moment · unchanged' : 'Original moment'),
        h('span', { class: 'quote-text' }, `“${ORIGINAL_LINE}”`),
      );
    }

    // Captions (hidden while the anchored quote already shows the same line)
    const cap = s.scene.caption;
    const showCap = live && st.captions && !!cap && !showQuote;
    this.caption.hidden = !showCap;
    if (cap && this.keyChanged('caption', JSON.stringify(cap) + showCap)) {
      const chip =
        cap.kind === 'hypothetical'
          ? h('span', { class: `chip chip-${cap.branch?.toLowerCase()}` }, `Hypothetical · Path ${cap.branch}`)
          : cap.kind === 'context'
            ? h('span', { class: 'chip chip-context' }, 'Context')
            : null;
      this.caption.replaceChildren(
        h('div', { class: 'caption-head' }, chip, h('span', { class: 'speaker' }, cap.speaker === 'You' ? 'You (hypothetical)' : cap.speaker)),
        h('p', { class: 'caption-text' }, cap.text),
      );
      this.speak(cap.text, s);
    }

    // Path labels
    for (const id of ['A', 'B'] as const) {
      const btn = this.panelLabels[id];
      const on = s.phase === 'UNFOLDED' && s.scene.panels[id];
      btn.hidden = !on;
      const sel = s.selection === id;
      btn.setAttribute('aria-pressed', String(sel));
      btn.classList.toggle('selected', sel);
      btn.disabled = s.participantPaused || s.linkHalted;
      (btn.querySelector('.path-action') as HTMLElement).textContent = sel
        ? 'Selected — your practitioner will begin it. Press again to deselect.'
        : `Choose Path ${id}`;
    }

    // Side note per state
    const noteKey = `${s.phase}|${s.visited.join('')}|${s.selection}`;
    if (this.keyChanged('note', noteKey)) {
      this.note.replaceChildren();
      this.note.hidden = true;
      if (s.phase === 'HELD') {
        this.setNote('Moment held', 'Your practitioner has held the scene exactly as it was. Nothing will move on until they continue.');
      } else if (s.phase === 'UNFOLDED') {
        this.setNote(
          'Same room, two possibilities',
          s.selection
            ? `You chose Path ${s.selection}. Your practitioner will begin it when ready.`
            : 'Two fictional possibilities have appeared on either side. They are not predictions. Choose one to explore.',
        );
      } else if (s.phase === 'RECOMPOSED') {
        this.setNote(
          'Original moment restored',
          `You are back at the same moment. Paths explored so far: ${s.visited.map((v) => `Path ${v}`).join(', ') || 'none'}.`,
        );
      }
    }

    // Hypothetical badge while exploring
    const exploring = s.phase === 'EXPLORING' && s.scene.hypotheticalLabel;
    this.hypBadge.hidden = !exploring;
    if (exploring && this.keyChanged('hyp', s.scene.hypotheticalLabel!)) {
      const b = BRANCHES[s.scene.hypotheticalLabel!];
      this.hypBadge.className = `hyp-badge path-${b.id.toLowerCase()}`;
      this.hypBadge.replaceChildren(
        h('span', { class: 'hyp-kicker' }, `Hypothetical · Path ${b.id}`),
        h('span', { class: 'hyp-title' }, b.label),
        h('span', { class: 'hyp-sub' }, 'A fictional possibility — not what Alex actually intended.'),
      );
    }

    this.returnBtn.hidden = s.phase !== 'EXPLORING';
    this.returnBtn.disabled = s.returnRequested || s.participantPaused;
    this.returnBtn.lastChild!.textContent = s.returnRequested
      ? 'Return requested — your practitioner will bring you back'
      : 'Request return to the original';

    // Safety controls: Pause in live states, Leave in every non-terminal state
    const terminal = s.phase === 'LEFT' || s.phase === 'ENDED';
    if (this.keyChanged('safety', `${live}|${terminal}`)) {
      this.safety.replaceChildren();
      if (live)
        this.safety.append(
          h('button', { class: 'btn safety-btn', 'data-testid': 'pause', onclick: () => this.port.send('PAUSE'), 'aria-keyshortcuts': 'Escape P' }, icon('pause'), 'Pause'),
        );
      if (!terminal)
        this.safety.append(h('button', { class: 'btn safety-btn', 'data-testid': 'leave', onclick: () => this.port.send('LEAVE') }, icon('leave'), 'Leave'));
    }
    this.safety.hidden = terminal || s.participantPaused || s.linkHalted;

    this.renderScreen(s);
    this.renderOverlay(s);

    // Announcements + chime
    if (prev && prev.phase !== s.phase) {
      const msg: Partial<Record<Session['phase'], string>> = {
        HELD: 'Moment held.',
        UNFOLDED: 'Two hypothetical paths have appeared. Path A on the left, Path B on the right.',
        EXPLORING: `Exploring hypothetical Path ${s.activeBranch}.`,
        RECOMPOSED: 'Original moment restored.',
        REFLECTION: 'Reflection.',
      };
      if (msg[s.phase]) this.announce(msg[s.phase]!);
      if (s.phase === 'RECOMPOSED') this.chime(s);
    }
    if (prev && !prev.linkHalted && s.linkHalted) this.announce('Connection to your practitioner was lost. The scene is paused.');
    if (s.participantPaused || s.linkHalted || !live) window.speechSynthesis?.cancel();
  }

  /** Called every frame: keep HTML labels pinned to their 3D anchors. */
  frame() {
    const s = this.s;
    if (!s) return;
    const v = this.view;
    if (!this.quote.hidden) {
      const p = v.project(v.room.quoteAnchor);
      this.quote.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
      this.quote.style.opacity = String(Math.max(0.0001, Math.min(1, v.ringReveal * 1.2)));
    }
    for (const id of ['A', 'B'] as const) {
      const btn = this.panelLabels[id];
      if (btn.hidden) continue;
      const p = v.project(v.room.panels[id].labelAnchor);
      btn.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      btn.style.opacity = String(v.panelReveal(id));
    }
  }

  private setNote(title: string, body: string) {
    this.note.hidden = false;
    this.note.replaceChildren(h('strong', { class: 'note-title' }, title), h('p', {}, body));
  }

  private keyChanged(region: string, key: string): boolean {
    if (this.keys[region] === key) return false;
    this.keys[region] = key;
    return true;
  }

  // ---------------- full screens ----------------
  private renderScreen(s: Session) {
    const key = `${s.phase}|${s.acknowledged}|${s.participantReady}|${s.clinicianConnected}|${JSON.stringify(s.settings)}|${s.visited.join('')}`;
    if (!this.keyChanged('screen', key)) return;
    const hadFocus = document.activeElement?.closest('.screen-host') ? (document.activeElement as HTMLElement).dataset.testid : null;
    const card = this.buildScreen(s);
    this.screen.replaceChildren();
    this.screen.hidden = !card;
    if (!card) return;
    this.screen.append(card);
    const again = hadFocus ? (card.querySelector(`[data-testid="${hadFocus}"]`) as HTMLElement | null) : null;
    (again ?? (card.querySelector('[data-autofocus]') as HTMLElement | null))?.focus({ preventScroll: true });
  }

  private buildScreen(s: Session): HTMLElement | null {
    const send = this.port.send;
    switch (s.phase) {
      case 'WELCOME':
        return h(
          'section',
          { class: 'card welcome', 'aria-labelledby': 'w-title', 'data-testid': 'screen-welcome' },
          h('p', { class: 'eyebrow' }, '01 · Welcome'),
          h('h1', { id: 'w-title' }, 'Therapeutic Realms'),
          h('p', { class: 'subtitle' }, 'The Living Scene'),
          h(
            'p',
            {},
            'A practitioner-guided prototype for looking at one ordinary conversation from more than one angle. You will meet Alex, a fictional colleague. A qualified practitioner guides the session from a separate desk.',
          ),
          h('p', { class: 'fine' }, 'Research prototype · desktop demonstration · not clinically validated'),
          h('button', { class: 'btn primary', 'data-autofocus': true, 'data-testid': 'enter', onclick: () => send('ENTER') }, 'Enter experience'),
        );
      case 'PREPARE':
        return h(
          'section',
          { class: 'card prepare', 'aria-labelledby': 'p-title', 'data-testid': 'screen-prepare' },
          h('p', { class: 'eyebrow' }, '02 · Prepare'),
          h('h2', { id: 'p-title' }, 'Set up for your comfort'),
          this.settingsForm(s),
          h(
            'label',
            { class: 'ack' },
            h('input', {
              type: 'checkbox',
              'data-testid': 'ack',
              checked: s.acknowledged,
              onchange: (e: Event) => send('ACKNOWLEDGE', { value: (e.target as HTMLInputElement).checked }),
            }),
            h(
              'span',
              {},
              'I understand this is a fictional, simulated conversation for reflective practice, guided by a qualified practitioner. Alex is a fictional colleague, not a therapist. I can pause or leave at any time.',
            ),
          ),
          h(
            'button',
            { class: 'btn primary', 'data-testid': 'continue', disabled: !s.acknowledged, 'data-autofocus': true, onclick: () => send('CONTINUE') },
            'Continue',
          ),
        );
      case 'WAITING':
        return h(
          'section',
          { class: 'card waiting', 'aria-labelledby': 'wt-title', 'data-testid': 'screen-waiting' },
          h('p', { class: 'eyebrow' }, '03 · Arrival'),
          h('h2', { id: 'wt-title' }, 'Waiting for your practitioner'),
          h(
            'ul',
            { class: 'status-list' },
            h('li', { 'data-ok': String(s.clinicianConnected), 'data-testid': 'wait-connected' }, icon(s.clinicianConnected ? 'check' : 'dot'), s.clinicianConnected ? 'Practitioner connected' : 'Practitioner not connected yet'),
            h('li', { 'data-ok': String(s.participantReady), 'data-testid': 'wait-ready' }, icon(s.participantReady ? 'check' : 'dot'), s.participantReady ? 'You are ready' : 'Tell your practitioner when you are ready'),
          ),
          h('p', { class: 'fine', 'data-testid': 'wait-code' }, `Session code for your practitioner’s Desk: ${s.sessionId}`),
          s.participantReady
            ? h('p', {}, 'The conversation will begin when your practitioner starts it. You do not need to do anything.')
            : h('button', { class: 'btn primary', 'data-testid': 'ready', 'data-autofocus': true, onclick: () => send('READY') }, 'I’m ready'),
        );
      case 'REFLECTION':
        return this.reflectionCard(s);
      case 'LEFT':
        return h(
          'section',
          { class: 'card', 'data-testid': 'screen-left' },
          h('h2', {}, 'You have left the session'),
          h('p', {}, 'Nothing else will happen in this scene. You can talk to your practitioner, or close this window.'),
          h('button', { class: 'btn ghost', 'data-autofocus': true, onclick: () => location.reload() }, 'Restart demo'),
        );
      case 'ENDED':
        return h(
          'section',
          { class: 'card', 'data-testid': 'screen-ended' },
          h('h2', {}, 'Session ended'),
          h('p', {}, 'Your practitioner has ended the session.'),
          h('button', { class: 'btn ghost', 'data-autofocus': true, onclick: () => location.reload() }, 'Restart demo'),
        );
      default:
        return null;
    }
  }

  private reflectionCard(s: Session) {
    const paths = s.visited.map((id) => {
      const b = BRANCHES[id];
      return h(
        'article',
        { class: `reflect-path path-${id.toLowerCase()}`, 'data-testid': `reflect-${id}` },
        h('span', { class: 'path-kicker' }, `Hypothetical · Path ${id} · explored`),
        h('strong', {}, b.label),
        h('p', {}, h('span', { class: 'who' }, 'You: '), `“${b.participantLine}”`),
        h('p', {}, h('span', { class: 'who' }, 'Alex: '), `“${b.alexLine}”`),
      );
    });
    return h(
      'section',
      { class: 'card reflection', 'aria-labelledby': 'r-title', 'data-testid': 'screen-reflection' },
      h('p', { class: 'eyebrow' }, '09 · Reflection'),
      h('h2', { id: 'r-title' }, 'What you explored'),
      h('div', { class: 'reflect-original' }, h('span', { class: 'quote-kicker' }, icon('lock'), 'Original moment'), h('p', { 'data-testid': 'reflect-original' }, `“${ORIGINAL_LINE}”`)),
      paths.length ? h('div', { class: 'reflect-paths' }, ...paths) : h('p', { class: 'empty', 'data-testid': 'reflect-empty' }, 'No hypothetical paths were explored in this session.'),
      h('p', { class: 'fine' }, 'These were fictional possibilities written in advance. They are not predictions, and neither is a “right” answer.'),
      h('h3', {}, REFLECTION_QUESTION),
      h(
        'label',
        { class: 'interp' },
        h('span', {}, 'Your interpretation — not verified (optional, stays on this screen, not saved)'),
        h('textarea', { rows: 2, 'data-testid': 'interpretation' }),
      ),
      h('p', { class: 'fine' }, 'Your practitioner will guide the discussion. Leave is always available at the bottom right.'),
    );
  }

  private settingsForm(s: Session) {
    const st = s.settings;
    const send = this.port.send;
    const toggle = (key: keyof typeof st, label: string, hint: string) =>
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          'data-testid': `set-${key}`,
          checked: Boolean(st[key]),
          onchange: (e: Event) => send('SAVE_SETTINGS', { [key]: (e.target as HTMLInputElement).checked }),
        }),
        h('span', { class: 'toggle-text' }, h('strong', {}, label), h('small', {}, hint)),
      );
    return h(
      'div',
      { class: 'settings', role: 'group', 'aria-label': 'Comfort settings' },
      toggle('captions', 'Captions', 'On by default'),
      toggle('reducedMotion', 'Reduced motion', 'Short fades instead of sweeps'),
      toggle('highContrast', 'High contrast', 'Stronger text and outlines'),
      toggle('voice', 'Spoken lines', 'Browser voice placeholder; varies by device'),
      h(
        'fieldset',
        { class: 'seg' },
        h('legend', {}, 'Caption size'),
        ...(['S', 'M', 'L'] as const).map((size) =>
          h(
            'label',
            {},
            h('input', {
              type: 'radio',
              name: 'capsize',
              value: size,
              'data-testid': `capsize-${size}`,
              checked: st.captionSize === size,
              onchange: () => send('SAVE_SETTINGS', { captionSize: size }),
            }),
            h('span', {}, { S: 'Small', M: 'Medium', L: 'Large' }[size]),
          ),
        ),
      ),
      h(
        'label',
        { class: 'range' },
        h('span', {}, 'Volume'),
        h('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.1,
          value: st.volume,
          'data-testid': 'set-volume',
          onchange: (e: Event) => send('SAVE_SETTINGS', { volume: Number((e.target as HTMLInputElement).value) }),
        }),
      ),
    );
  }

  // ---------------- pause / link-loss overlay ----------------
  private renderOverlay(s: Session) {
    const show = (s.participantPaused || s.linkHalted) && isLive(s);
    const key = `${show}|${s.participantPaused}|${s.linkHalted}|${s.clinicianConnected}|${JSON.stringify(s.settings)}`;
    if (!this.keyChanged('overlay', key)) return;
    const hadFocus = document.activeElement?.closest('.overlay-host') ? (document.activeElement as HTMLElement).dataset.testid : null;
    this.overlay.replaceChildren();
    this.overlay.hidden = !show;
    if (!show) return;
    const send = this.port.send;
    const title = s.participantPaused ? 'Paused' : 'Connection to your practitioner was lost';
    const body = s.linkHalted
      ? s.clinicianConnected
        ? 'Your practitioner has reconnected and will continue when ready. You can leave at any time.'
        : 'The scene is paused and will not move on by itself. You can leave at any time.'
      : 'The scene is paused exactly where it was. Resume when you are ready, or leave.';
    const card = h(
      'section',
      { class: 'card pause-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pz-title', 'data-testid': 'pause-overlay' },
      h('h2', { id: 'pz-title' }, title),
      h('p', {}, body),
      s.participantPaused && s.linkHalted ? h('p', { class: 'fine' }, 'Practitioner link: lost. Resuming will keep the scene held until they reconnect.') : null,
      h(
        'div',
        { class: 'row' },
        s.participantPaused
          ? h('button', { class: 'btn primary', 'data-testid': 'resume', 'data-autofocus': true, onclick: () => send('RESUME') }, icon('play'), 'Resume')
          : null,
        h('button', { class: 'btn ghost', 'data-testid': 'leave-overlay', 'data-autofocus': !s.participantPaused, onclick: () => send('LEAVE') }, icon('leave'), 'Leave'),
      ),
      h('details', { class: 'pause-settings' }, h('summary', {}, 'Comfort settings'), this.settingsForm(s)),
    );
    if (hadFocus) (card.querySelector('details') as HTMLDetailsElement).open = true;
    this.overlay.append(card);
    const again = hadFocus ? (card.querySelector(`[data-testid="${hadFocus}"]`) as HTMLElement | null) : null;
    (again ?? (card.querySelector('[data-autofocus]') as HTMLElement | null))?.focus({ preventScroll: true });
  }

  // ---------------- audio (optional) ----------------
  private speak(text: string, s: Session) {
    if (!s.settings.voice || s.settings.volume <= 0 || text === this.lastSpoken || !('speechSynthesis' in window)) return;
    this.lastSpoken = text;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.volume = s.settings.volume;
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch {
      /* voice is optional; captions carry every line */
    }
  }

  private chime(s: Session) {
    if (s.settings.volume <= 0) return;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const now = ctx.currentTime;
      for (const [f, t] of [
        [523.25, 0],
        [783.99, 0.12],
      ]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, now + t);
        g.gain.linearRampToValueAtTime(0.12 * s.settings.volume, now + t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.9);
        o.connect(g).connect(ctx.destination);
        o.start(now + t);
        o.stop(now + t + 1);
      }
    } catch {
      /* audio optional */
    }
  }
}
