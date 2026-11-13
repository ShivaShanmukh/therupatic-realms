// A flat panel in the 3D world whose face is drawn with a 2D canvas.
// Buttons drawn on it are hit-tested from the ray's UV coordinate.
import * as THREE from 'three';
import type { Interactive } from '../view3d/sceneView';

export const VR_COLORS = {
  bg: 'rgba(22, 15, 12, 0.93)',
  border: 'rgba(255, 226, 190, 0.4)',
  ink: '#f6eee6',
  ink2: '#d9cbbd',
  amber: '#f2b366',
  amberInk: '#ffd9a3',
  A: '#8cc0ff',
  B: '#cfa9ff',
  focus: '#ffd27f',
};
const FONT = `'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif`;
const SERIF = `Georgia, 'Times New Roman', serif`;

type Btn = { id: string; x: number; y: number; w: number; h: number; enabled: boolean; onSelect: () => void };

export interface TextOpts {
  size?: number;
  weight?: number;
  color?: string;
  maxW?: number;
  align?: CanvasTextAlign;
  lh?: number;
  serif?: boolean;
  spacing?: number; // letter spacing in px
  upper?: boolean;
}

export class CanvasPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  private tex: THREE.CanvasTexture;
  private buttons: Btn[] = [];
  private hoverBy = new Map<string, string | null>();
  private key = '';
  private drawFn: (p: CanvasPanel) => void = () => {};
  hc = false;

  constructor(name: string, readonly wM: number, readonly hM: number, pxPerM = 1000) {
    this.W = Math.round(wM * pxPerM);
    this.H = Math.round(hM * pxPerM);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(wM, hM),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, side: THREE.FrontSide }),
    );
    this.mesh.name = `VR:${name}`;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /** Redraw only when the key changes (or hover changes). */
  set(key: string, draw: (p: CanvasPanel) => void) {
    if (key === this.key) return;
    this.key = key;
    this.drawFn = draw;
    this.render();
  }

  render() {
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.buttons = [];
    this.drawFn(this);
    this.tex.needsUpdate = true;
  }

  get hoverId(): string | null {
    for (const v of this.hoverBy.values()) if (v) return v;
    return null;
  }

  /** Ids of buttons currently drawn (for tests). */
  get buttonIds() {
    return this.buttons.map((b) => ({ id: b.id, enabled: b.enabled }));
  }

  private hit(uv: THREE.Vector2 | null): Btn | null {
    if (!uv) return null;
    const x = uv.x * this.W;
    const y = (1 - uv.y) * this.H;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;
  }

  /** Centre of a drawn button in panel UV space (0..1), or null. */
  buttonUV(id: string): { u: number; v: number } | null {
    const b = this.buttons.find((x) => x.id === id);
    return b ? { u: (b.x + b.w / 2) / this.W, v: 1 - (b.y + b.h / 2) / this.H } : null;
  }

  /** Programmatic press by id (tests, keyboard fallback). */
  press(id: string): boolean {
    const b = this.buttons.find((x) => x.id === id);
    if (!b || !b.enabled) return false;
    b.onSelect();
    return true;
  }

  interactive(): Interactive {
    return {
      object: this.mesh,
      active: () => this.buttons.length > 0,
      hover: (src, uv) => {
        const id = this.hit(uv)?.id ?? null;
        if (this.hoverBy.get(src) === id) return;
        const before = this.hoverId;
        this.hoverBy.set(src, id);
        if (before !== this.hoverId) this.render();
      },
      select: (_src, uv) => {
        const b = this.hit(uv);
        if (b && b.enabled) b.onSelect();
      },
    };
  }

  // ---------- drawing helpers ----------
  card(border = VR_COLORS.border, radius = 36) {
    const c = this.ctx;
    const lw = this.hc ? 8 : 4;
    rounded(c, lw / 2, lw / 2, this.W - lw, this.H - lw, radius);
    c.fillStyle = this.hc ? '#000' : VR_COLORS.bg;
    c.fill();
    c.lineWidth = lw;
    c.strokeStyle = this.hc ? '#fff' : border;
    c.stroke();
  }

  text(str: string, x: number, y: number, o: TextOpts = {}): number {
    const c = this.ctx;
    const size = o.size ?? 30;
    const lh = o.lh ?? size * 1.32;
    c.font = `${o.weight ?? 400} ${size}px ${o.serif ? SERIF : FONT}`;
    c.fillStyle = this.hc && (o.color === VR_COLORS.ink2 || !o.color) ? '#fff' : (o.color ?? VR_COLORS.ink);
    c.textAlign = o.align ?? 'left';
    c.textBaseline = 'top';
    (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${o.spacing ?? 0}px`;
    const s = o.upper ? str.toUpperCase() : str;
    const lines = o.maxW ? wrap(c, s, o.maxW) : [s];
    for (const line of lines) {
      c.fillText(line, x, y);
      y += lh;
    }
    (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    return y;
  }

  button(
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    o: { enabled?: boolean; primary?: boolean; selected?: boolean; color?: string; size?: number; onSelect: () => void },
  ) {
    const enabled = o.enabled !== false;
    const hover = this.hoverId === id && enabled;
    const c = this.ctx;
    rounded(c, x, y, w, h, Math.min(h / 2, 40));
    if (o.primary) c.fillStyle = this.hc ? '#fff' : hover ? '#ffe1b8' : '#f3d2a6';
    else c.fillStyle = this.hc ? '#000' : hover ? 'rgba(60, 44, 34, 0.98)' : 'rgba(36, 26, 21, 0.96)';
    c.globalAlpha = enabled ? 1 : 0.45;
    c.fill();
    c.lineWidth = hover || o.selected ? 7 : this.hc ? 5 : 3;
    c.strokeStyle = hover ? VR_COLORS.focus : o.selected ? (o.color ?? VR_COLORS.amber) : this.hc ? '#fff' : (o.color ?? 'rgba(255,226,190,0.45)');
    c.stroke();
    const size = o.size ?? Math.round(h * 0.38);
    c.font = `600 ${size}px ${FONT}`;
    c.fillStyle = o.primary ? '#1d120b' : VR_COLORS.ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, x + w / 2, y + h / 2 + 1);
    c.globalAlpha = 1;
    this.buttons.push({ id, x, y, w, h, enabled, onSelect: o.onSelect });
  }
}

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}
