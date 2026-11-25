// Director Desk: clinician-only controls. Rendered outside the participant view
// (side panel) or in its own window. Never imported by the participant UI.
import { clinicianOptions } from '../core/machine';
import { ANCHOR_ID, BRANCHES } from '../core/scenario';
import { diffScene } from '../core/snapshot';
import type { EventType, Session } from '../core/types';
import { h } from './dom';

export interface DeskPort {
  subscribe(fn: (s: Session, last: { type: EventType; accepted: boolean; reason?: string; actor: string } | null) => void): void;
  send(type: EventType, payload?: Record<string, unknown>): void;
  /** Drop the link (embedded: system DISCONNECT; separate window: stop heartbeats). */
  dropLink(): void;
  resendLast(): void;
  sendAs(actor: 'clinician' | 'participant' | 'system', type: EventType, payload?: Record<string, unknown>): void;
  openSeparate?: () => void;
  previewCanvas?: () => HTMLCanvasElement | null;
  restore3D?: () => { status: 'pending' | 'pass' | 'fail' | 'n/a'; diffs: string[] };
}

const PHASE_NAMES: Record<Session['phase'], string> = {
  WELCOME: 'Welcome',
  PREPARE: 'Preparing',
  WAITING: 'Waiting to start',
  CONVERSATION: 'Conversation',
  HELD: 'Moment held',
  UNFOLDED: 'Unfolded',
  EXPLORING: 'Exploring',
  RECOMPOSED: 'Original restored',
  REFLECTION: 'Reflection',
  ENDED: 'Ended',
  LEFT: 'Participant left',
};
function phaseName(s: Session): string {
  if (s.phase === 'EXPLORING' && s.activeBranch) return `Exploring Path ${s.activeBranch}`;
  return PHASE_NAMES[s.phase];
}

const RAW_TYPES: EventType[] = ['START', 'HOLD', 'UNFOLD', 'BEGIN_BRANCH', 'RECOMPOSE', 'REFLECT', 'RESUME_SESSION', 'END', 'CONNECT'];

export class DirectorDesk {
  private s: Session | null = null;
  private readouts: HTMLElement;
  private buttons: Partial<Record<string, HTMLButtonElement>> = {};
  private notice: HTMLElement;
  private log: HTMLElement;
  private justification: HTMLInputElement;
  private justWrap: HTMLElement;
  private preview: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private previewText: HTMLElement;
  private linkPill = h('span', { class: 'link-pill', 'data-testid': 'desk-link' });
  private phaseLabel = h('span', { class: 'phase-label', 'data-testid': 'desk-phase' });
  private alerts = h('div', { class: 'desk-alerts', 'data-testid': 'desk-alerts', role: 'status', 'aria-live': 'polite' });

  constructor(host: HTMLElement, private port: DeskPort) {
    host.classList.add('desk');
    const btn = (type: string, label: string, onclick: () => void, cls = 'btn desk-btn') => {
      const b = h('button', { class: cls, 'data-testid': `desk-${type}`, onclick }, label);
      this.buttons[type] = b;
      return b;
    };
    this.justification = h('input', {
      type: 'text',
      placeholder: 'Reason for ending without exploring',
      'data-testid': 'desk-justification',
      'aria-label': 'Early-end justification',
    });
    this.justWrap = h('div', { class: 'just' }, this.justification);
    this.readouts = h('dl', { class: 'readouts', 'data-testid': 'desk-readouts' });
    this.notice = h('div', { class: 'desk-notice', role: 'status', 'aria-live': 'polite', 'data-testid': 'desk-notice' });
    this.log = h('ol', { class: 'desk-log', 'data-testid': 'desk-log' });
    this.previewText = h('p', { class: 'preview-text', 'data-testid': 'desk-preview-text' });
    const canvas = port.previewCanvas?.();
    if (canvas !== undefined) {
      this.preview = h('canvas', { width: 320, height: 180, class: 'preview', 'aria-label': 'Participant view preview' });
      this.previewCtx = this.preview.getContext('2d');
    }

    const rawSelect = h('select', { 'aria-label': 'Command', 'data-testid': 'raw-type' }, ...RAW_TYPES.map((t) => h('option', { value: t }, t)));

    const dev = new URLSearchParams(location.search).has('dev');
    host.append(
      // 1. Status first: who is connected, what state the session is in, anything needing attention.
      h(
        'header',
        { class: 'desk-head' },
        h('div', { class: 'desk-title' }, h('h2', {}, 'Director Desk'), h('span', {}, 'Therapist only · not shown to the participant')),
        h('div', { class: 'desk-status-bar' }, this.linkPill, this.phaseLabel),
        this.alerts,
      ),
      // 2. Primary controls — only permitted commands are enabled.
      h(
        'section',
        { class: 'desk-sec desk-primary' },
        h(
          'div',
          { class: 'desk-grid' },
          btn('START', 'Start', () => port.send('START')),
          btn('HOLD', 'Hold', () => port.send('HOLD')),
          btn('UNFOLD', 'Unfold', () => port.send('UNFOLD')),
          btn('BEGIN_BRANCH', 'Begin path', () => port.send('BEGIN_BRANCH', { branch: this.s?.selection })),
          btn('RECOMPOSE', 'Recompose', () => port.send('RECOMPOSE')),
          btn('REFLECT', 'Reflect', () => port.send('REFLECT', { justification: this.justification.value })),
        ),
        this.justWrap,
        this.notice,
      ),
      // 3. Link + end.
      h(
        'section',
        { class: 'desk-sec' },
        h('h3', {}, 'Link'),
        h(
          'div',
          { class: 'desk-row' },
          btn('CONNECT', 'Connect', () => port.send('CONNECT')),
          btn('DROP', 'Simulate link loss', () => port.dropLink(), 'btn desk-btn warn'),
          btn('RESUME_SESSION', 'Resume session', () => port.send('RESUME_SESSION')),
          btn('END', 'End session', () => port.send('END'), 'btn desk-btn danger'),
        ),
      ),
      h('section', { class: 'desk-sec' }, h('h3', {}, 'Participant view'), this.preview, this.previewText),
      h('section', { class: 'desk-sec' }, h('h3', {}, 'Session details'), this.readouts),
      // 4. Developer material, collapsed. The test harness exists only with ?dev.
      h(
        'details',
        { class: 'desk-sec diagnostics', 'data-testid': 'desk-diagnostics' },
        h('summary', {}, 'Diagnostics · event log'),
        this.log,
        dev
          ? h(
              'div',
              { class: 'harness', 'data-testid': 'desk-harness' },
              h('p', { class: 'fine' }, 'Test harness (dev only): sends commands even when the button would be disabled, to prove the rules reject them.'),
              h(
                'div',
                { class: 'desk-row' },
                rawSelect,
                h('button', { class: 'btn desk-btn', 'data-testid': 'raw-send', onclick: () => port.sendAs('clinician', rawSelect.value as EventType, { branch: this.s?.selection ?? 'A' }) }, 'Send anyway'),
              ),
              h(
                'div',
                { class: 'desk-row' },
                h('button', { class: 'btn desk-btn', 'data-testid': 'raw-dup', onclick: () => port.resendLast() }, 'Re-send last event (duplicate)'),
                port.openSeparate ? h('button', { class: 'btn desk-btn', onclick: () => port.openSeparate!() }, 'Open desk in separate window') : null,
              ),
            )
          : null,
      ),
    );

    port.subscribe((s, last) => this.update(s, last));
  }

  private update(s: Session, last: { type: EventType; accepted: boolean; reason?: string; actor: string } | null) {
    this.s = s;
    const o = clinicianOptions(s);
    for (const [k, b] of Object.entries(this.buttons)) {
      if (!b) continue;
      if (k === 'CONNECT') b.disabled = s.clinicianConnected;
      else if (k === 'DROP') b.disabled = !s.clinicianConnected;
      else b.disabled = !o[k as keyof typeof o];
    }
    const begin = this.buttons.BEGIN_BRANCH!;
    begin.textContent = s.selection ? `Begin ${s.selection}` : 'Begin path';
    begin.title = s.selection ? BRANCHES[s.selection].label : 'Waiting for the participant to choose';

    const link = !s.clinicianConnected ? (s.linkHalted ? 'Link lost' : 'Disconnected') : s.linkHalted ? 'Connected · halted' : 'Connected';
    this.linkPill.textContent = link;
    this.linkPill.dataset.ok = String(s.clinicianConnected && !s.linkHalted);
    this.phaseLabel.textContent = `Session: ${phaseName(s)}`;
    const alerts: Array<[string, 'warn' | 'info']> = [];
    if (s.linkHalted) alerts.push(['Scene halted after link loss — reconnect, then Resume session', 'warn']);
    if (s.participantPaused) alerts.push(['Participant paused', 'warn']);
    if (s.returnRequested) alerts.push(['Participant asked to return to the original', 'info']);
    if (s.phase === 'UNFOLDED' && s.selection) alerts.push([`Participant chose Path ${s.selection} · ${BRANCHES[s.selection].label}`, 'info']);
    this.alerts.replaceChildren(...alerts.map(([a, kind]) => h('span', { class: 'desk-alert', 'data-kind': kind }, a)));
    this.justWrap.hidden = !(s.visited.length === 0 && (s.phase === 'HELD' || s.phase === 'UNFOLDED'));
    if (!this.justWrap.hidden) {
      const ok = s.clinicianConnected && !s.linkHalted && !s.participantPaused;
      this.buttons.REFLECT!.disabled = !ok;
    }

    const restore =
      s.snapshot && (s.phase === 'RECOMPOSED' || s.phase === 'REFLECTION')
        ? diffScene(s.snapshot.scene, s.phase === 'REFLECTION' ? { ...s.scene, anchor: s.snapshot.scene.anchor } : s.scene)
        : null;
    const r3 = this.port.restore3D?.();
    const rows: Array<[string, string, string?]> = [
      ['State', s.phase, 'state'],
      ['Therapist link', s.clinicianConnected ? (s.linkHalted ? 'Connected · halted' : 'Connected') : s.linkHalted ? 'LOST · scene halted' : 'Disconnected', 'link'],
      ['Participant', s.participantReady ? 'Ready' : 'Not ready', 'ready'],
      ['Participant pause', s.participantPaused ? 'PAUSED by participant' : 'No', 'paused'],
      ['Original moment', s.snapshot ? `${s.snapshot.anchorId} saved · locked` : `${ANCHOR_ID} not yet captured`, 'anchor'],
      ['Selected path', s.selection ? `Path ${s.selection}` : '—', 'selection'],
      ['Explored paths', s.visited.length ? s.visited.map((v) => `Path ${v}`).join(', ') : 'none', 'visited'],
      ['Return request', s.returnRequested ? 'PENDING — participant asked to return' : '—', 'return'],
      ['Restores', String(s.restoreCount), 'restores'],
      ['Restore check (data)', restore === null ? '—' : restore.length === 0 ? 'PASS · identical to M01' : `FAIL · ${restore.length} differences`, 'restore-data'],
      ['Restore check (3D)', !r3 || r3.status === 'n/a' ? '—' : r3.status === 'pending' ? 'checking…' : r3.status === 'pass' ? 'PASS · pose, lights, camera match' : `FAIL · ${r3.diffs.slice(0, 2).join('; ')}`, 'restore-3d'],
    ];
    this.readouts.replaceChildren(...rows.flatMap(([k, v, id]) => [h('dt', {}, k), h('dd', { 'data-testid': `ro-${id}`, 'data-alert': String(/LOST|PAUSED|PENDING|FAIL/.test(v)) }, v)]));

    if (last && last.actor !== 'system' && last.actor !== 'participant') {
      this.notice.textContent = last.accepted ? `✓ ${last.type} accepted` : `✗ ${last.type} rejected — ${last.reason}`;
      this.notice.dataset.ok = String(last.accepted);
    }
    this.previewText.textContent = s.scene.caption ? `Caption: ${s.scene.caption.speaker}: “${s.scene.caption.text}”` : 'Caption: —';

    this.log.replaceChildren(
      ...s.log.slice(-14).reverse().map((e) =>
        h('li', { 'data-ok': String(e.accepted) }, `${e.eventId} ${e.actor} ${e.type} ${e.accepted ? '✓' : `✗ ${e.reason ?? ''}`}`),
      ),
    );
  }

  /** Copy the participant canvas into the small preview (embedded mode only). */
  drawPreview() {
    const src = this.port.previewCanvas?.();
    if (!src || !this.previewCtx || !this.preview) return;
    this.previewCtx.drawImage(src, 0, 0, this.preview.width, this.preview.height);
  }
}
