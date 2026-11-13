// Alex: a deliberately stylised, seated fictional colleague built from simple shapes.
// Poses are procedural, so a given (pose, animTime) always produces exactly the same frame.
// That is what lets HOLD freeze a frame and RECOMPOSE bring back the identical frame.
import * as THREE from 'three';
import type { AlexPose } from '../core/types';

type Params = {
  headRX: number;
  headRY: number;
  headRZ: number;
  torsoSY: number;
  mouth: number;
  eyes: number;
  uArmLX: number;
  uArmRX: number;
  uArmRZ: number;
  fArmLX: number;
  fArmRX: number;
};

const KEYS = Object.keys({
  headRX: 0, headRY: 0, headRZ: 0, torsoSY: 0, mouth: 0, eyes: 0,
  uArmLX: 0, uArmRX: 0, uArmRZ: 0, fArmLX: 0, fArmRX: 0,
} satisfies Params) as (keyof Params)[];

/** Deterministic pose function. */
export function poseParams(pose: AlexPose, t: number): Params {
  const breath = Math.sin(t * 1.6);
  const p: Params = {
    headRX: 0.05 + 0.015 * Math.sin(t * 0.7),
    headRY: 0.04 * Math.sin(t * 0.37),
    headRZ: 0,
    torsoSY: 1 + 0.008 * breath,
    mouth: 0,
    eyes: 1,
    uArmLX: -0.12,
    uArmRX: -0.12,
    uArmRZ: -0.1,
    fArmLX: -1.05,
    fArmRX: -1.05,
  };
  const evalPose = pose === 'held' ? 'listening' : pose;
  if (evalPose === 'speaking') {
    p.mouth = 0.2 + 0.8 * Math.abs(Math.sin(t * 9.5) * Math.sin(t * 3.1 + 1));
    p.headRX += 0.03 * Math.sin(t * 4.2);
    p.headRY += 0.03 * Math.sin(t * 1.3);
    p.fArmRX = -1.2 - 0.25 * (0.5 + 0.5 * Math.sin(t * 2.3));
    p.uArmRX = -0.22 - 0.08 * (0.5 + 0.5 * Math.sin(t * 2.3));
  } else if (evalPose === 'listening') {
    p.headRZ = 0.06;
    p.headRX = 0.08 + 0.01 * Math.sin(t * 0.7);
  } else {
    p.headRY = 0.1 + 0.04 * Math.sin(t * 0.37); // idle: gaze slightly aside
  }
  if (pose !== 'held' && t % 4.3 < 0.12) p.eyes = 0.1; // blink, never while held
  return p;
}

function limb(len: number, radius: number, mat: THREE.Material, up = false) {
  const g = new THREE.CapsuleGeometry(radius, len, 6, 12);
  g.translate(0, up ? len / 2 : -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class Alex {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private torso = new THREE.Group();
  private mouth: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private uArmL = new THREE.Group();
  private uArmR = new THREE.Group();
  private fArmL = new THREE.Group();
  private fArmR = new THREE.Group();

  private clock = 0; // free-running animation time
  private pose: AlexPose = 'idle';
  private frozenTime = 0;
  private from: Params = poseParams('idle', 0);
  private blend = 1;
  private blendDur = 0.6;
  current: Params = poseParams('idle', 0);

  constructor() {
    this.root.name = 'Alex';
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89a7c, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.9 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.85 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.6 });

    const hips = new THREE.Group();
    hips.position.set(0, 0.56, -0.12);
    this.root.add(hips);

    // legs
    for (const sx of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(sx * 0.1, 0, 0);
      thigh.rotation.set(-Math.PI / 2 + 0.06, sx * 0.04, 0);
      thigh.add(limb(0.36, 0.075, trousers));
      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      knee.rotation.x = Math.PI / 2 - 0.12;
      knee.add(limb(0.38, 0.06, trousers));
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.22), dark);
      shoe.position.set(0, -0.46, 0.06);
      shoe.castShadow = true;
      knee.add(shoe);
      thigh.add(knee);
      hips.add(thigh);
    }

    // torso
    this.torso.rotation.x = -0.1;
    hips.add(this.torso);
    const chest = limb(0.3, 0.17, shirt, true);
    chest.scale.set(1.05, 1, 0.75);
    this.torso.add(chest);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin);
    neck.position.y = 0.6;
    this.torso.add(neck);

    // head
    this.head.position.set(0, 0.64, 0.01);
    this.torso.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 32, 24), skin);
    skull.scale.set(0.92, 1.08, 1);
    skull.position.y = 0.11;
    skull.castShadow = true;
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.125, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairTop.position.set(0, 0.13, -0.008);
    hairTop.rotation.x = -0.25;
    hairTop.scale.set(0.98, 1.1, 1.05);
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), hair);
    hairBack.position.set(0, 0.07, -0.045);
    hairBack.scale.set(1.02, 1.05, 0.85);
    this.head.add(skull, hairTop, hairBack);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), dark);
      eye.position.set(sx * 0.038, 0.125, 0.1);
      this.eyes.push(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.006, 0.01), hair);
      brow.position.set(sx * 0.038, 0.153, 0.104);
      brow.rotation.z = sx * -0.08;
      this.head.add(eye, brow);
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.01), new THREE.MeshStandardMaterial({ color: 0x5a2a24 }));
    this.mouth.position.set(0, 0.06, 0.108);
    this.head.add(this.mouth);

    // arms
    const arms: Array<[THREE.Group, THREE.Group, number]> = [
      [this.uArmL, this.fArmL, -1],
      [this.uArmR, this.fArmR, 1],
    ];
    for (const [upper, fore, sx] of arms) {
      upper.position.set(sx * 0.2, 0.5, 0);
      upper.rotation.z = sx * 0.1;
      upper.add(limb(0.24, 0.055, shirt));
      fore.position.set(0, -0.28, 0);
      fore.add(limb(0.22, 0.045, shirt));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skin);
      hand.scale.set(0.8, 1.1, 0.6);
      hand.position.y = -0.3;
      hand.castShadow = true;
      fore.add(hand);
      upper.add(fore);
      this.torso.add(upper);
    }
  }

  setReducedMotion(on: boolean) {
    this.blendDur = on ? 0.15 : 0.6;
  }

  /** Current animation time (what HOLD records). */
  get animTime(): number {
    return this.pose === 'held' ? this.frozenTime : this.clock;
  }

  setPose(pose: AlexPose, animTime: number) {
    if (pose === this.pose && (pose !== 'held' || animTime === this.frozenTime)) return;
    this.from = { ...this.current };
    this.blend = 0;
    this.pose = pose;
    if (pose === 'held') this.frozenTime = animTime;
    else this.clock = Math.max(this.clock, animTime);
  }

  update(dt: number) {
    if (this.pose !== 'held') this.clock += dt;
    const target = poseParams(this.pose, this.animTime);
    this.blend = Math.min(1, this.blend + dt / this.blendDur);
    const w = this.blend >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * this.blend);
    const cur = {} as Params;
    for (const k of KEYS) cur[k] = w === 1 ? target[k] : this.from[k] + (target[k] - this.from[k]) * w;
    this.current = cur;

    this.head.rotation.set(cur.headRX, cur.headRY, cur.headRZ);
    this.torso.scale.y = cur.torsoSY;
    this.mouth.scale.y = 1 + cur.mouth * 2.6;
    for (const e of this.eyes) e.scale.y = cur.eyes;
    this.uArmL.rotation.x = cur.uArmLX;
    this.uArmR.rotation.x = cur.uArmRX;
    this.uArmR.rotation.z = -cur.uArmRZ;
    this.fArmL.rotation.x = cur.fArmLX;
    this.fArmR.rotation.x = cur.fArmRX;
  }

  /** Rounded live values for restore verification. */
  inspect() {
    const r = (v: number) => Math.round(v * 1e5) / 1e5;
    const out: Record<string, number | string | boolean> = { pose: this.pose, animTime: r(this.animTime), settled: this.blend >= 1 };
    for (const k of KEYS) out[k] = r(this.current[k]);
    const p = this.root.getWorldPosition(new THREE.Vector3());
    out.x = r(p.x);
    out.y = r(p.y);
    out.z = r(p.z);
    out.rotY = r(this.root.rotation.y);
    return out;
  }
}
