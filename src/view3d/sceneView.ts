// SceneView: draws the room from a SceneState. It never decides anything —
// it only follows the state the machine produced. The camera is set from the
// fixed seat and is never animated.
import * as THREE from 'three';
import type { BranchId, SceneState, Settings } from '../core/types';
import { Alex } from './alex';
import { PATH_COLOR, buildRoom, type RoomRig } from './room';

class Tween {
  value: number;
  target: number;
  constructor(v = 0) {
    this.value = v;
    this.target = v;
  }
  step(dt: number, dur: number) {
    if (this.value === this.target) return;
    const d = dur <= 0 ? 1 : dt / dur;
    if (Math.abs(this.target - this.value) <= d) this.value = this.target;
    else this.value += Math.sign(this.target - this.value) * d;
  }
  get settled() {
    return this.value === this.target;
  }
}


function isShown(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export interface ViewHooks {
  onFrame?: (view: SceneView) => void;
  onPanelClick?: (id: BranchId) => void;
}

/** Anything in the 3D world that a mouse or VR controller can point at and select. */
export interface Interactive {
  object: THREE.Object3D;
  active: () => boolean;
  hover?: (source: string, uv: THREE.Vector2 | null) => void;
  select: (source: string, uv: THREE.Vector2 | null) => void;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  /** The participant's seat. The camera (or headset) is its child; the rig itself never moves. */
  readonly rig = new THREE.Group();
  readonly interactives: Interactive[] = [];
  private hovered = new Map<string, Interactive | null>();
  readonly scene = new THREE.Scene();
  readonly room: RoomRig;
  readonly alex = new Alex();
  private tw = {
    A: new Tween(),
    B: new Tween(),
    ring: new Tween(),
    dim: new Tween(),
    tint: new Tween(),
  };
  private tintId: BranchId | null = null;
  private selection: BranchId | null = null;
  private hover: BranchId | null = null;
  private reducedMotion = false;
  private highContrast = false;
  private last = performance.now();
  private raycaster = new THREE.Raycaster();
  private hooks: ViewHooks;
  frameCount = 0;

  constructor(private container: HTMLElement, hooks: ViewHooks = {}) {
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.className = 'scene-canvas';
    this.renderer.xr.enabled = true;
    // 'local' = origin at the head when VR starts, so the rig puts the eyes at the seat
    // whether the person sits or stands. No locomotion; the system recentre resets it.
    this.renderer.xr.setReferenceSpaceType('local');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);
    this.rig.name = 'ParticipantSeatRig';
    this.rig.add(this.camera);
    this.scene.background = new THREE.Color(0x120c0a);
    this.room = buildRoom();
    this.scene.add(this.room.root);
    this.alex.root.position.set(0, 0, -0.75);
    this.scene.add(this.alex.root);
    this.scene.add(this.rig);
    for (const id of ['A', 'B'] as const) {
      this.interactives.push({
        object: this.room.panels[id].surface,
        active: () => this.tw[id].value > 0.95,
        hover: (src, uv) => this.setPanelHover(src, uv ? id : null, id),
        select: () => this.hooks.onPanelClick?.(id),
      });
    }

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointer(e, false));
    this.renderer.domElement.addEventListener('click', (e) => this.onPointer(e, true));
    this.renderer.domElement.addEventListener('pointerleave', () => this.pointAt('mouse', null));
    // setAnimationLoop drives both the normal page and the headset. Start after wiring.
    requestAnimationFrame(() => this.renderer.setAnimationLoop(this.loop));
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Apply the machine's scene description. Safe to call every update. */
  apply(scene: SceneState, settings: Settings, selection: BranchId | null) {
    this.reducedMotion = settings.reducedMotion;
    this.highContrast = settings.highContrast;
    this.alex.setReducedMotion(settings.reducedMotion);
    this.selection = selection;

    // Seat: copied from state (which never changes). No tween, ever.
    // In VR the headset drives the camera inside the rig; on desktop we aim it at Alex.
    this.rig.position.set(...scene.camera.position);
    this.rig.updateMatrixWorld();
    if (!this.renderer.xr.isPresenting) {
      this.camera.position.set(0, 0, 0);
      this.camera.lookAt(new THREE.Vector3(...scene.camera.target));
      this.camera.updateMatrixWorld();
    }

    this.alex.root.position.set(...scene.alex.position);
    this.alex.root.rotation.y = scene.alex.rotationY;
    this.alex.setPose(scene.alex.pose, scene.alex.animTime);

    this.tw.A.target = scene.panels.A ? 1 : 0;
    this.tw.B.target = scene.panels.B ? 1 : 0;
    this.tw.ring.target = scene.anchor.ring ? 1 : 0;
    this.tw.dim.target = scene.lighting.peripheralDim;
    if (scene.lighting.tint) this.tintId = scene.lighting.tint;
    this.tw.tint.target = scene.lighting.tint ? 1 : 0;
  }

  /** Zones and ring crossfade in 0.65 s (design: 0.5–0.8 s); reduced motion: near-instant. */
  private get dur() {
    return this.reducedMotion ? 0.15 : 0.65;
  }

  private focusPath: BranchId | null = null;
  /** Keyboard focus on a path label highlights its zone like a hover. */
  setFocusPath(id: BranchId | null) {
    this.focusPath = id;
  }

  /** Frame-time samples (ms) for the optional fps readout. */
  frameMs = 0;
  private beforeRender: Array<(dt: number) => void> = [];
  onBeforeRender(fn: (dt: number) => void) {
    this.beforeRender.push(fn);
  }

  private loop = () => {
    const now = performance.now();
    const raw = now - this.last;
    this.frameMs = this.frameMs * 0.9 + raw * 0.1;
    const dt = Math.min(0.25, raw / 1000);
    this.last = now;
    this.step(dt);
    for (const fn of this.beforeRender) fn(dt);
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    this.hooks.onFrame?.(this);
  };

  private step(dt: number) {
    for (const t of Object.values(this.tw)) t.step(dt, this.dur);
    this.alex.update(dt);
    const { lights, base, room } = { lights: this.room.lights, base: this.room.base, room: this.room };

    const dim = this.tw.dim.value;
    lights.hemi.intensity = base.hemi * (1 - 0.55 * dim);
    lights.ambient.intensity = base.ambient * (1 - 0.55 * dim);
    lights.lamp.intensity = base.lamp * (1 - 0.5 * dim);
    lights.sun.intensity = base.sun * (1 - 0.4 * dim);
    lights.face.intensity = base.face;
    room.lampShade.material.emissiveIntensity = 0.9 * (1 - 0.4 * dim);

    if (this.tintId) lights.tint.color.setHex(PATH_COLOR[this.tintId]);
    lights.tint.intensity = 2.2 * this.tw.tint.value;

    // Hold: one subtle amber ring around Alex. The floor ring stays off; the ceiling motif is decor.
    const ring = this.tw.ring.value;
    room.anchorRing.scale.setScalar(1);
    room.anchorRing.material.opacity = 0.75 * ring;
    room.anchorRing.visible = ring > 0.001;
    room.floorRing.visible = false;
    lights.anchorGlow.intensity = 0.6 * ring;
    room.ceilingRing.material.opacity = 0.3;

    // Unfold: thin zones crossfade in place (no rising, no scaling).
    for (const id of ['A', 'B'] as const) {
      const v = this.tw[id].value;
      const p = room.panels[id];
      p.group.visible = v > 0.001;
      p.group.scale.y = 1;
      const selected = this.selection === id;
      const other = this.selection !== null && !selected;
      const hover = this.hover === id || this.focusPath === id;
      const fill = this.highContrast ? 0.16 : 0.06;
      p.surface.material.opacity = v * (selected ? fill + 0.08 : hover ? fill + 0.05 : other ? fill * 0.6 : fill);
      p.surface.material.emissiveIntensity = selected ? 0.5 : hover ? 0.4 : 0.25;
      p.pattern.material.opacity = v * (this.highContrast ? 0.16 : 0.07) * (selected || hover ? 1.6 : 1);
      p.rim.material.opacity = v * (selected || hover ? 1 : other ? 0.45 : 0.85);
      p.slot.material.emissiveIntensity = 0.45 * v;
      p.guide.material.opacity = v * (selected ? 0.9 : 0.5);
      p.guide.visible = v > 0.001;
    }
  }

  /** Screen position (px, relative to the canvas) of a 3D anchor. */
  project(obj: THREE.Object3D): { x: number; y: number; visible: boolean } {
    const v = obj.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 };
  }

  /** Path zone currently under the mouse or a controller ray. */
  get hoveredPath(): BranchId | null {
    return this.hover;
  }

  panelReveal(id: BranchId) {
    return this.tw[id].value;
  }

  get ringReveal() {
    return this.tw.ring.value;
  }

  private panelHoverBy = new Map<string, BranchId | null>();
  private setPanelHover(src: string, id: BranchId | null, owner: BranchId) {
    if (id === null && this.panelHoverBy.get(src) !== owner) return;
    this.panelHoverBy.set(src, id);
    this.hover = [...this.panelHoverBy.values()].find((v) => v !== null) ?? null;
  }

  private onPointer(e: PointerEvent | MouseEvent, click: boolean) {
    if (this.renderer.xr.isPresenting) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.pointAt('mouse', this.raycaster.ray);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
    if (click && hit) hit.target.select('mouse', hit.uv);
  }

  /** Point a ray (mouse or controller) into the world. Updates hover; returns what it hits. */
  pointAt(source: string, ray: THREE.Ray | null): { target: Interactive; uv: THREE.Vector2 | null; distance: number } | null {
    let best: { target: Interactive; uv: THREE.Vector2 | null; distance: number } | null = null;
    if (ray) {
      this.raycaster.ray.copy(ray);
      for (const it of this.interactives) {
        if (!it.active() || !isShown(it.object)) continue;
        const h = this.raycaster.intersectObject(it.object, false)[0];
        if (h && (!best || h.distance < best.distance)) best = { target: it, uv: h.uv ?? null, distance: h.distance };
      }
    }
    const prev = this.hovered.get(source) ?? null;
    if (prev && prev !== best?.target) prev.hover?.(source, null);
    if (best) best.target.hover?.(source, best.uv);
    this.hovered.set(source, best?.target ?? null);
    return best;
  }

  /** Live 3D values used by automated restore checks. */
  inspect() {
    const v = (o: THREE.Object3D) => {
      const p = o.getWorldPosition(new THREE.Vector3());
      return [r4(p.x), r4(p.y), r4(p.z)];
    };
    const L = this.room.lights;
    return {
      camera: {
        position: this.camera.getWorldPosition(new THREE.Vector3()).toArray().map(r4),
        quaternion: this.camera.getWorldQuaternion(new THREE.Quaternion()).toArray().map(r4),
      },
      alex: this.alex.inspect(),
      lights: {
        hemi: r4(L.hemi.intensity),
        ambient: r4(L.ambient.intensity),
        sun: r4(L.sun.intensity),
        lamp: r4(L.lamp.intensity),
        face: r4(L.face.intensity),
        tint: r4(L.tint.intensity),
        anchorGlow: r4(L.anchorGlow.intensity),
      },
      panels: { A: r4(this.tw.A.value), B: r4(this.tw.B.value) },
      ring: r4(this.tw.ring.value),
      landmarks: Object.fromEntries(Object.entries(this.room.landmarks).map(([k, o]) => [k, v(o)])),
      settled: Object.values(this.tw).every((t) => t.settled) && this.alex.inspect().settled === true,
    };
  }
}
