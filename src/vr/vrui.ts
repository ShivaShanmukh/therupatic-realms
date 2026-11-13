// In-world participant UI for VR. Same rules as the desktop overlays (participant.ts),
// drawn on panels anchored in the room. No clinician controls here.
//
// Placement (from the seat, eyes at y≈1.12): menus ~1 m ahead and a little below gaze;
// captions just under them; Pause/Leave low on the right like an armrest control;
// the original quote and path labels stay on the room geometry they belong to.
import * as THREE from 'three';
import { isLive } from '../core/machine';
import { BRANCHES, ORIGINAL_LINE, REFLECTION_QUESTION } from '../core/scenario';
import type { BranchId, EventType, Session, Settings } from '../core/types';
import type { SceneView } from '../view3d/sceneView';
import { CanvasPanel, VR_COLORS as C } from './canvasPanel';

export interface VRPort {
  send: (type: EventType, payload?: Record<string, unknown>) => void;
  exitVR: () => void;
}

const PHASE_TITLE: Partial<Record<Session['phase'], string>> = {
  CONVERSATION: '04 · The conversation',
  HELD: '05 · Moment held',
  UNFOLDED: '06 · Unfold the scene',
  EXPLORING: '07 · Explore a possibility',
  RECOMPOSED: '08 · Original moment restored',
};

export class VRUI {
  readonly panels: Record<string, CanvasPanel>;
  private s: Session | null = null;
  private active = false;
  private eye = new THREE.Vector3();

  constructor(private view: SceneView, private port: VRPort, private showFps = false) {
    const P = (name: string, w: number, h: number, px = 1000) => new CanvasPanel(name, w, h, px);
    this.panels = {
      main: P('main', 1.1, 0.82),
      caption: P('caption', 1.15, 0.3),
      quote: P('quote', 1.3, 0.3),
      A: P('pathA', 0.92, 0.6),
      B: P('pathB', 0.92, 0.6),
      note: P('note', 0.64, 0.3),
      badge: P('badge', 0.64, 0.28),
      safety: P('safety', 0.46, 0.13),
      ret: P('return', 0.52, 0.13),
      fps: P('fps', 0.34, 0.07),
    };
    const eye = new THREE.Vector3(...view.rig.position.toArray());
    this.eye.copy(eye);
    const place = (p: CanvasPanel, x: number, y: number, z: number) => {
      p.mesh.position.set(x, y, z);
      view.scene.add(p.mesh);
    };
    place(this.panels.main, 0, 1.0, 1.42);
    place(this.panels.caption, 0, 0.8, 1.38);
    place(this.panels.quote, 0, 0.66, -0.12);
    place(this.panels.note, 0.56, 1.32, 1.3);
    place(this.panels.badge, -0.56, 1.32, 1.3);
    place(this.panels.safety, 0.4, 0.76, 1.66);
    place(this.panels.ret, -0.42, 0.76, 1.66);
    place(this.panels.fps, 0, 1.56, 1.3);
    // Path labels ride on the hypothetical panels, so they rise with them.
    for (const id of ['A', 'B'] as const) {
      const lab = this.panels[id];
      lab.mesh.position.copy(view.room.panels[id].labelAnchor.position).add(new THREE.Vector3(0, 0, 0.02));
      view.room.panels[id].group.add(lab.mesh);
    }
    for (const p of Object.values(this.panels)) {
      view.interactives.push(p.interactive());
    }
    view.onBeforeRender(() => this.frame());
  }

  /** Turn the in-world UI on (in VR, or desktop preview with ?vrui). */
  setActive(on: boolean) {
    this.active = on;
    if (this.s) this.update(this.s);
  }

  private faceEye() {
    this.eye.copy(this.view.rig.position);
    for (const k of ['main', 'caption', 'quote', 'note', 'badge', 'safety', 'ret', 'fps']) this.panels[k].mesh.lookAt(this.eye);
  }

  update(s: Session) {
    this.s = s;
    const P = this.panels;
    const hc = s.settings.highContrast;
    for (const p of Object.values(P)) p.hc = hc;
    this.faceEye();
    if (!this.active) {
      for (const p of Object.values(P)) p.mesh.visible = false;
      return;
    }
    const live = isLive(s);
    const halted = s.participantPaused || s.linkHalted;
    const terminal = s.phase === 'LEFT' || s.phase === 'ENDED';
    const st = JSON.stringify(s.settings);

    // ---- main panel: full screens and the pause/link-loss menu ----
    const screen = !live || halted;
    P.main.mesh.visible = screen;
    if (screen) {
      const key = `${s.phase}|${s.acknowledged}|${s.participantReady}|${s.clinicianConnected}|${s.participantPaused}|${s.linkHalted}|${st}|${s.visited.join('')}|${hc}`;
      P.main.set(key, (p) => this.drawMain(p, s));
    }

    // ---- caption ----
    const cap = s.scene.caption;
    const quoteShown = s.scene.anchor.quote && live;
    P.caption.mesh.visible = live && !halted && s.settings.captions && !!cap && !quoteShown;
    if (P.caption.mesh.visible && cap) {
      P.caption.set(`${JSON.stringify(cap)}|${s.settings.captionSize}|${hc}`, (p) => {
        p.card(cap.kind === 'hypothetical' ? C[cap.branch!] : C.border);
        const scale = { S: 0.85, M: 1, L: 1.22 }[s.settings.captionSize];
        let x = 40;
        if (cap.kind === 'hypothetical') {
          const label = `HYPOTHETICAL · PATH ${cap.branch}`;
          p.ctx.font = `800 26px sans-serif`;
          const w = p.ctx.measureText(label).width + label.length * 3;
          p.text(label, x, 28, { size: 26, weight: 800, color: C[cap.branch!], spacing: 3 });
          x += w + 36;
        } else if (cap.kind === 'context') {
          p.text('CONTEXT', x, 28, { size: 26, weight: 800, color: C.ink2, spacing: 3 });
          x += 170;
        }
        p.text(cap.speaker === 'You' ? 'You (hypothetical)' : cap.speaker, x, 28, { size: 26, weight: 700, color: C.ink2 });
        p.text(cap.text, 40, 72, { size: Math.round(44 * scale), maxW: p.W - 80, lh: Math.round(54 * scale) });
      });
    }

    // ---- original quote, near Alex ----
    P.quote.mesh.visible = quoteShown && !halted;
    if (P.quote.mesh.visible) {
      P.quote.set(`${s.phase}|${hc}`, (p) => {
        p.card(C.amber);
        p.text(s.phase === 'UNFOLDED' ? 'ORIGINAL MOMENT · UNCHANGED' : 'ORIGINAL MOMENT', p.W / 2, 34, { size: 34, weight: 800, color: C.amber, align: 'center', spacing: 5 });
        p.text(`“${ORIGINAL_LINE}”`, p.W / 2, 100, { size: 64, align: 'center', maxW: p.W - 80 });
      });
    }

    // ---- path labels on the A/B panels ----
    for (const id of ['A', 'B'] as const) {
      const lab = P[id];
      lab.mesh.visible = s.phase === 'UNFOLDED' && s.scene.panels[id] && !halted;
      if (!lab.mesh.visible) continue;
      const sel = s.selection === id;
      lab.set(`${sel}|${hc}`, (p) => this.drawPath(p, id, sel));
    }

    // ---- side note ----
    let note: [string, string] | null = null;
    if (s.phase === 'HELD') note = ['Moment held', 'Your practitioner has held the scene exactly as it was. Nothing moves on until they continue.'];
    else if (s.phase === 'UNFOLDED')
      note = [
        'Same room, two possibilities',
        s.selection ? `You chose Path ${s.selection}. Your practitioner will begin it when ready.` : 'Two fictional possibilities, left and right. Not predictions. Point and pull the trigger to choose one.',
      ];
    else if (s.phase === 'RECOMPOSED')
      note = ['Original moment restored', `You are back at the same moment. Explored so far: ${s.visited.map((v) => `Path ${v}`).join(', ') || 'none'}.`];
    P.note.mesh.visible = !!note && !halted;
    if (note) {
      const [title, body] = note;
      P.note.set(`${title}|${body}|${hc}|${PHASE_TITLE[s.phase]}`, (p) => {
        p.card();
        p.text(PHASE_TITLE[s.phase] ?? '', 34, 26, { size: 22, weight: 700, color: C.amber, spacing: 3, upper: true });
        p.text(title, 34, 62, { size: 34, weight: 700, color: C.amberInk });
        p.text(body, 34, 110, { size: 27, color: C.ink2, maxW: p.W - 68, lh: 36 });
      });
    }

    // ---- hypothetical badge while exploring ----
    const exploring = s.phase === 'EXPLORING' ? s.scene.hypotheticalLabel : null;
    P.badge.mesh.visible = !!exploring && !halted;
    if (exploring) {
      const b = BRANCHES[exploring];
      P.badge.set(`${b.id}|${hc}`, (p) => {
        p.card(C[b.id]);
        p.text(`HYPOTHETICAL · PATH ${b.id}`, 34, 30, { size: 28, weight: 800, color: C[b.id], spacing: 4 });
        p.text(b.label, 34, 76, { size: 40, weight: 600 });
        p.text('A fictional possibility — not what Alex actually intended.', 34, 140, { size: 26, color: C.ink2, maxW: p.W - 68 });
      });
    }

    // ---- safety controls (always reachable in live states; Leave in all non-terminal) ----
    P.safety.mesh.visible = !terminal && !screen;
    if (P.safety.mesh.visible) {
      P.safety.set(`${live}|${hc}`, (p) => {
        const half = (p.W - 30) / 2;
        if (live) p.button('pause', 'Pause', 10, 10, half - 5, p.H - 20, { onSelect: () => this.port.send('PAUSE'), size: 48 });
        p.button('leave', 'Leave', live ? 20 + half : 10, 10, live ? half - 5 : p.W - 20, p.H - 20, { onSelect: () => this.port.send('LEAVE'), size: 48 });
      });
    }
    P.ret.mesh.visible = s.phase === 'EXPLORING' && !halted;
    if (P.ret.mesh.visible) {
      P.ret.set(`${s.returnRequested}|${hc}`, (p) =>
        p.button('return', s.returnRequested ? 'Return requested' : 'Request return', 10, 10, p.W - 20, p.H - 20, {
          enabled: !s.returnRequested,
          onSelect: () => this.port.send('REQUEST_RETURN'),
          size: 42,
        }),
      );
    }
    P.fps.mesh.visible = this.showFps;
  }

  private drawPath(p: CanvasPanel, id: BranchId, sel: boolean) {
    const b = BRANCHES[id];
    p.card(C[id], 30);
    if (sel) {
      p.ctx.lineWidth = 12;
      p.ctx.strokeStyle = C[id];
      p.ctx.strokeRect(8, 8, p.W - 16, p.H - 16);
    }
    p.text(`HYPOTHETICAL · PATH ${id}`, 40, 36, { size: 40, weight: 800, color: C[id], spacing: 4 });
    p.text(b.label, 40, 100, { size: 68, weight: 600, maxW: p.W - 80 });
    p.text('One possible continuation', 40, 190, { size: 38, color: C.ink2 });
    p.button(`path-${id}`, sel ? 'Selected · press to undo' : `Choose Path ${id}`, 40, p.H - 170, p.W - 80, 130, {
      selected: sel,
      color: C[id],
      onSelect: () => this.port.send(sel ? 'DESELECT' : 'SELECT', { branch: id }),
      size: 46,
    });
  }

  private drawMain(p: CanvasPanel, s: Session) {
    const send = this.port.send;
    const W = p.W;
    const pad = 60;
    p.card();
    const eyebrow = (t: string) => p.text(t, pad, 50, { size: 26, weight: 700, color: C.amber, spacing: 5, upper: true });
    const bottomBtn = (id: string, label: string, onSelect: () => void, o: { enabled?: boolean; primary?: boolean; x?: number; w?: number } = {}) =>
      p.button(id, label, o.x ?? pad, p.H - 140, o.w ?? 420, 96, { onSelect, primary: o.primary ?? true, enabled: o.enabled, size: 38 });

    if (s.participantPaused || (s.linkHalted && isLive(s))) {
      const title = s.participantPaused ? 'Paused' : 'Connection to your practitioner was lost';
      const body = s.linkHalted
        ? s.clinicianConnected
          ? 'Your practitioner has reconnected and will continue when ready. You can leave at any time.'
          : 'The scene is paused and will not move on by itself. You can leave at any time.'
        : 'The scene is paused exactly where it was. Resume when you are ready, or leave.';
      p.text(title, pad, 60, { size: 54, serif: true, maxW: W - 2 * pad });
      let y = p.text(body, pad, s.participantPaused ? 140 : 210, { size: 32, color: C.ink2, maxW: W - 2 * pad });
      y = this.settingsRows(p, s.settings, y + 20, false);
      if (s.participantPaused) bottomBtn('resume', 'Resume', () => send('RESUME'));
      bottomBtn('leave-overlay', 'Leave', () => send('LEAVE'), { primary: false, x: s.participantPaused ? pad + 450 : pad });
      return;
    }

    switch (s.phase) {
      case 'WELCOME':
        eyebrow('01 · Welcome');
        p.text('Therapeutic Realms', pad, 100, { size: 76, serif: true });
        p.text('THE LIVING SCENE', pad, 200, { size: 28, spacing: 10, weight: 600 });
        p.text(
          'A practitioner-guided prototype for looking at one ordinary conversation from more than one angle. You will meet Alex, a fictional colleague. A qualified practitioner guides the session from a separate desk.',
          pad, 270, { size: 32, color: C.ink2, maxW: W - 2 * pad },
        );
        p.text('Research prototype · not clinically validated · point and pull the trigger to select', pad, 520, { size: 24, color: C.ink2, maxW: W - 2 * pad });
        bottomBtn('enter', 'Enter experience', () => send('ENTER'));
        return;
      case 'PREPARE': {
        eyebrow('02 · Prepare');
        p.text('Set up for your comfort', pad, 92, { size: 50, serif: true });
        const y = this.settingsRows(p, s.settings, 170, true);
        p.button('ack', s.acknowledged ? '✓  I understand' : 'I understand', pad, y + 10, W - 2 * pad, 80, {
          selected: s.acknowledged,
          onSelect: () => send('ACKNOWLEDGE', { value: !s.acknowledged }),
          size: 32,
        });
        p.text('This is a fictional, simulated conversation for reflective practice, guided by a qualified practitioner. Alex is a fictional colleague, not a therapist. I can pause or leave at any time.', pad, y + 104, { size: 25, color: C.ink2, maxW: W - 2 * pad, lh: 32 });
        bottomBtn('continue', 'Continue', () => send('CONTINUE'), { enabled: s.acknowledged });
        return;
      }
      case 'WAITING': {
        eyebrow('03 · Arrival');
        p.text('Waiting for your practitioner', pad, 92, { size: 50, serif: true });
        const row = (ok: boolean, text: string, y: number) => {
          p.text(ok ? '✓' : '○', pad, y, { size: 38, color: ok ? '#a8e0b0' : C.ink2 });
          p.text(text, pad + 60, y + 2, { size: 34 });
        };
        row(s.clinicianConnected, s.clinicianConnected ? 'Practitioner connected' : 'Practitioner not connected yet', 200);
        row(s.participantReady, s.participantReady ? 'You are ready' : 'Tell your practitioner when you are ready', 270);
        p.text(`Session code: ${s.sessionId}`, pad, 360, { size: 28, color: C.ink2 });
        if (s.participantReady) p.text('The conversation will begin when your practitioner starts it. You do not need to do anything.', pad, 440, { size: 32, color: C.ink2, maxW: W - 2 * pad });
        else bottomBtn('ready', 'I’m ready', () => send('READY'));
        return;
      }
      case 'REFLECTION': {
        eyebrow('09 · Reflection');
        p.text('What you explored', pad, 88, { size: 46, serif: true });
        p.text('ORIGINAL MOMENT', pad, 160, { size: 22, weight: 800, color: C.amber, spacing: 4 });
        p.text(`“${ORIGINAL_LINE}”`, pad, 192, { size: 32 });
        let y = 250;
        if (s.visited.length === 0) y = p.text('No hypothetical paths were explored in this session.', pad, y, { size: 28, color: C.ink2 });
        const colW = (W - 2 * pad - 30) / 2;
        s.visited.forEach((id, i) => {
          const b = BRANCHES[id];
          const x = pad + i * (colW + 30);
          p.text(`PATH ${id} · ${b.label}`, x, y, { size: 22, weight: 800, color: C[id], spacing: 2 });
          let yy = p.text(`You: “${b.participantLine}”`, x, y + 36, { size: 22, maxW: colW, lh: 28 });
          yy = p.text(`Alex: “${b.alexLine}”`, x, yy + 6, { size: 22, maxW: colW, lh: 28 });
        });
        y = 520;
        p.text('Fictional possibilities written in advance — not predictions, and neither is a “right” answer.', pad, y, { size: 22, color: C.ink2, maxW: W - 2 * pad });
        p.text(REFLECTION_QUESTION, pad, y + 60, { size: 30, weight: 600, maxW: W - 2 * pad });
        p.text('Talk it through with your practitioner. Leave is below whenever you want.', pad, y + 110, { size: 22, color: C.ink2 });
        bottomBtn('leave-reflection', 'Leave', () => send('LEAVE'), { primary: false, w: 300 });
        return;
      }
      case 'LEFT':
      case 'ENDED':
        p.text(s.phase === 'LEFT' ? 'You have left the session' : 'Session ended', pad, 80, { size: 54, serif: true });
        p.text(
          s.phase === 'LEFT' ? 'Nothing else will happen in this scene. You can take the headset off or exit VR.' : 'Your practitioner has ended the session.',
          pad, 180, { size: 32, color: C.ink2, maxW: W - 2 * pad },
        );
        bottomBtn('exit-vr', 'Exit VR', () => this.port.exitVR());
        return;
      default:
        return;
    }
  }

  /** Comfort settings as large toggle buttons. Returns the y below them. */
  private settingsRows(p: CanvasPanel, st: Settings, y: number, full: boolean): number {
    const send = this.port.send;
    const pad = 60;
    const gap = 20;
    const colW = (p.W - 2 * pad - gap) / 2;
    const h = 74;
    const tog = (id: keyof Settings, label: string, col: number, row: number) => {
      const on = Boolean(st[id]);
      p.button(`set-${id}`, `${label}: ${on ? 'On' : 'Off'}`, pad + col * (colW + gap), y + row * (h + gap), colW, h, {
        selected: on,
        onSelect: () => send('SAVE_SETTINGS', { [id]: !on }),
        size: 30,
      });
    };
    tog('captions', 'Captions', 0, 0);
    tog('reducedMotion', 'Reduced motion', 1, 0);
    tog('highContrast', 'High contrast', 0, 1);
    tog('voice', 'Spoken lines', 1, 1);
    const r2 = y + 2 * (h + gap);
    const third = (colW - 2 * 10) / 3;
    (['S', 'M', 'L'] as const).forEach((sz, i) =>
      p.button(`capsize-${sz}`, { S: 'Small', M: 'Medium', L: 'Large' }[sz], pad + i * (third + 10), r2, third, h, {
        selected: st.captionSize === sz,
        onSelect: () => send('SAVE_SETTINGS', { captionSize: sz }),
        size: 26,
      }),
    );
    const vx = pad + colW + gap;
    p.button('vol-down', '−', vx, r2, 90, h, { onSelect: () => send('SAVE_SETTINGS', { volume: Math.max(0, +(st.volume - 0.2).toFixed(1)) }), size: 44 });
    p.text(`Volume ${Math.round(st.volume * 100)}%`, vx + 90 + (colW - 180) / 2, r2 + 20, { size: 28, align: 'center' });
    p.button('vol-up', '+', vx + colW - 90, r2, 90, h, { onSelect: () => send('SAVE_SETTINGS', { volume: Math.min(1, +(st.volume + 0.2).toFixed(1)) }), size: 44 });
    void full;
    return r2 + h + gap;
  }

  private fpsTick = 0;
  private frame() {
    if (!this.showFps || !this.active) return;
    if (++this.fpsTick % 15) return;
    const ms = this.view.frameMs;
    this.panels.fps.set(`${Math.round(ms * 10)}`, (p) => {
      p.card();
      p.text(`${(1000 / ms).toFixed(0)} fps · ${ms.toFixed(1)} ms`, p.W / 2, 18, { size: 30, align: 'center' });
    });
  }

  /** Test aid: where a panel button appears on the desktop canvas (px), so a real mouse ray can hit it. */
  buttonScreenPoint(panel: string, id: string): { x: number; y: number } | null {
    const p = this.panels[panel];
    const uv = p?.buttonUV(id);
    if (!p || !uv || !p.mesh.visible) return null;
    p.mesh.updateWorldMatrix(true, false);
    const world = p.mesh.localToWorld(new THREE.Vector3((uv.u - 0.5) * p.wM, (uv.v - 0.5) * p.hM, 0));
    const o = new THREE.Object3D();
    o.position.copy(world);
    o.updateMatrixWorld();
    const s = this.view.project(o);
    return { x: s.x, y: s.y };
  }

  /** Test aid: press a button on a named panel. */
  press(panel: string, id: string): boolean {
    return this.panels[panel]?.press(id) ?? false;
  }
}
