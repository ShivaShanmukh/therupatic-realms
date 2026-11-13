// The one room. Built once, never replaced. Only lights and overlays change.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { citySunset, fabric, oakPanel, panelPattern, plaster, rug, stone, woodFloor } from './textures';

export const ROOM = { minX: -3.2, maxX: 3.2, minZ: -3.0, maxZ: 3.6, h: 3.0 };
export const AMBER = 0xf2b366;
export const PATH_COLOR = { A: 0x7fb6ff, B: 0xc49bff } as const;

export interface PanelRig {
  group: THREE.Group; // pivot at floor so it can rise from the slot
  surface: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshStandardMaterial>;
  pattern: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  rim: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  slot: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  labelAnchor: THREE.Object3D; // where the HTML label is projected
}

export interface RoomRig {
  root: THREE.Group;
  lights: {
    hemi: THREE.HemisphereLight;
    ambient: THREE.AmbientLight;
    sun: THREE.DirectionalLight;
    lamp: THREE.PointLight;
    face: THREE.SpotLight;
    tint: THREE.PointLight;
    anchorGlow: THREE.PointLight;
  };
  base: Record<'hemi' | 'ambient' | 'sun' | 'lamp' | 'face', number>;
  lampShade: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  ceilingRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  anchorRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  floorRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  quoteAnchor: THREE.Object3D;
  panels: { A: PanelRig; B: PanelRig };
  /** Named fixed landmarks; tests read their world positions to prove the room never moves. */
  landmarks: Record<'window' | 'table' | 'mug' | 'plant' | 'alexChair' | 'lamp', THREE.Object3D>;
}

const std = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });

function box(w: number, h: number, d: number, mat: THREE.Material, r = 0) {
  const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function archShape(w: number, h: number, inset = 0): THREE.Shape {
  const r = w / 2 - inset;
  const s = new THREE.Shape();
  s.moveTo(-r, inset);
  s.lineTo(r, inset);
  s.lineTo(r, h - w / 2);
  s.absarc(0, h - w / 2, r, 0, Math.PI, false);
  s.lineTo(-r, inset);
  return s;
}

function buildPanel(id: 'A' | 'B', x: number, z: number, rotY: number): PanelRig {
  const W = 1.0;
  const H = 1.75;
  const group = new THREE.Group();
  group.position.set(x, 0.02, z);
  group.rotation.y = rotY;
  group.name = `Panel${id}`;

  const color = PATH_COLOR[id];
  const surface = new THREE.Mesh(
    new THREE.ShapeGeometry(archShape(W, H), 24),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.28,
      roughness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  surface.name = `Panel${id}Surface`;

  const pattern = new THREE.Mesh(
    new THREE.ShapeGeometry(archShape(W, H, 0.03), 24),
    new THREE.MeshBasicMaterial({
      map: panelPattern(id === 'A' ? 'stripes' : 'dots'),
      color,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  pattern.position.z = 0.002;

  const rimShape = archShape(W, H);
  rimShape.holes.push(archShape(W, H, 0.022) as unknown as THREE.Path);
  const rim = new THREE.Mesh(
    new THREE.ShapeGeometry(rimShape, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
  );
  rim.position.z = 0.004;

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, H * 0.55, 0.01);

  group.add(surface, pattern, rim, labelAnchor);

  // Brass floor slot the panel rises from: part of the room, always visible.
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.12, 0.012, 0.07),
    std(0x8a6a3c, { metalness: 0.7, roughness: 0.35, emissive: color, emissiveIntensity: 0 }),
  );
  slot.position.set(x, 0.006, z);
  slot.rotation.y = rotY;
  slot.receiveShadow = true;

  return { group, surface, pattern, rim, slot, labelAnchor };
}

export function buildRoom(): RoomRig {
  const root = new THREE.Group();
  root.name = 'LivingSceneRoom';
  const { minX, maxX, minZ, maxZ, h } = ROOM;
  const W = maxX - minX;
  const D = maxZ - minZ;

  // Floor + ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std(0xffffff, { map: woodFloor(), roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std(0x5a4636, { map: plaster() }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, h, (minZ + maxZ) / 2);
  root.add(floor, ceiling);

  // Walls: left oak, right stone, back = window, front plaster (behind viewer)
  const oak = std(0xffffff, { map: oakPanel(), roughness: 0.7 });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(D, h), oak);
  left.rotation.y = Math.PI / 2;
  left.position.set(minX, h / 2, (minZ + maxZ) / 2);
  const rightMat = std(0xffffff, { map: stone(), roughness: 0.95 });
  const right = new THREE.Mesh(new THREE.PlaneGeometry(D, h), rightMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(maxX, h / 2, (minZ + maxZ) / 2);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, h), std(0x6e5a4a, { map: plaster() }));
  front.rotation.y = Math.PI;
  front.position.set(0, h / 2, maxZ);
  for (const m of [left, right, front]) m.receiveShadow = true;
  root.add(left, right, front);

  // Back wall: window from x -2.6..2.6, floor to ceiling
  const winHalf = 2.6;
  const backMat = std(0xffffff, { map: oakPanel() });
  for (const sx of [-1, 1]) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(maxX - winHalf, h), backMat);
    seg.position.set(sx * (winHalf + (maxX - winHalf) / 2), h / 2, minZ);
    root.add(seg);
  }
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 13),
    new THREE.MeshBasicMaterial({ map: citySunset(), toneMapped: false, fog: false }),
  );
  sky.position.set(0, 2.2, minZ - 7);
  sky.name = 'WindowView';
  root.add(sky);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(winHalf * 2, h),
    new THREE.MeshStandardMaterial({ color: 0xffe0c0, transparent: true, opacity: 0.06, roughness: 0.05, metalness: 0.2 }),
  );
  glass.position.set(0, h / 2, minZ + 0.01);
  root.add(glass);
  const frameMat = std(0x24170f, { roughness: 0.6 });
  for (const x of [-winHalf, -0.95, 0.95, winHalf]) {
    const m = box(0.08, h, 0.12, frameMat);
    m.position.set(x, h / 2, minZ + 0.03);
    root.add(m);
  }
  const transom = box(winHalf * 2, 0.07, 0.12, frameMat);
  transom.position.set(0, 2.45, minZ + 0.03);
  const sill = box(winHalf * 2 + 0.2, 0.1, 0.3, frameMat);
  sill.position.set(0, 0.05, minZ + 0.12);
  root.add(transom, sill);
  const windowMarker = new THREE.Object3D();
  windowMarker.position.set(0, 1.5, minZ);
  root.add(windowMarker);

  // Bookshelf on the left wall
  const shelfMat = std(0x2d1b10, { roughness: 0.7 });
  const shelf = new THREE.Group();
  shelf.position.set(minX + 0.18, 0, -1.9);
  const back = box(0.04, 2.2, 1.4, shelfMat);
  back.position.set(-0.14, 1.1, 0);
  shelf.add(back);
  const bookColors = [0x7a3b2e, 0x2f4a5a, 0x8a7a52, 0x4a3a5a, 0x5a6a3a, 0x9a5a3a, 0x3a3a3a];
  for (let i = 0; i < 5; i++) {
    const y = 0.15 + i * 0.48;
    const board = box(0.32, 0.03, 1.4, shelfMat);
    board.position.set(0, y, 0);
    shelf.add(board);
    let zz = -0.62;
    let k = i * 3;
    while (zz < 0.55 && i < 4) {
      const bw = 0.035 + ((k * 37) % 5) * 0.008;
      const bh = 0.24 + ((k * 13) % 7) * 0.02;
      const b = box(0.22, bh, bw, std(bookColors[k % bookColors.length], { roughness: 0.9 }));
      b.position.set(0, y + 0.015 + bh / 2, zz + bw / 2);
      shelf.add(b);
      zz += bw + 0.004 + (k % 6 === 0 ? 0.12 : 0);
      k++;
    }
  }
  root.add(shelf);

  // Rug, coffee table, mug, book
  const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), std(0xffffff, { map: rug(), roughness: 1 }));
  rugMesh.rotation.x = -Math.PI / 2;
  rugMesh.position.set(0, 0.004, 0.55);
  rugMesh.receiveShadow = true;
  root.add(rugMesh);

  const table = new THREE.Group();
  table.position.set(0, 0, 0.75);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 48), std(0x3a2416, { roughness: 0.45 }));
  top.position.y = 0.42;
  top.castShadow = top.receiveShadow = true;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.4, 16), std(0x24170f));
  stem.position.y = 0.2;
  stem.castShadow = true;
  table.add(top, stem);
  const mug = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.09, 24), std(0xe8e0d4, { roughness: 0.5 }));
  cup.castShadow = true;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16), std(0xe8e0d4, { roughness: 0.5 }));
  handle.position.x = 0.048;
  mug.add(cup, handle);
  mug.position.set(0.18, 0.49, 0.05);
  const book = box(0.22, 0.03, 0.3, std(0x2f4a5a, { roughness: 0.8 }));
  book.position.set(-0.12, 0.46, -0.02);
  book.rotation.y = 0.35;
  table.add(mug, book);
  root.add(table);

  // Alex's armchair
  const chairMat = std(0xffffff, { map: fabric(34, 66), roughness: 0.95 });
  const alexChair = new THREE.Group();
  alexChair.position.set(0, 0, -0.95);
  const seat = box(0.82, 0.2, 0.72, chairMat, 0.06);
  seat.position.set(0, 0.36, 0.02);
  const backRest = box(0.82, 0.62, 0.2, chairMat, 0.08);
  backRest.position.set(0, 0.72, -0.3);
  backRest.rotation.x = -0.12;
  const armL = box(0.16, 0.36, 0.72, chairMat, 0.06);
  armL.position.set(-0.45, 0.5, 0.0);
  const armR = armL.clone();
  armR.position.x = 0.45;
  const chairBase = box(0.86, 0.22, 0.74, std(0x5a4636), 0.03);
  chairBase.position.set(0, 0.13, 0);
  alexChair.add(seat, backRest, armL, armR, chairBase);
  root.add(alexChair);

  // Participant's chair arms, just visible at the bottom corners of the view
  const myArmMat = std(0xffffff, { map: fabric(28, 48), roughness: 0.95 });
  for (const sx of [-1, 1]) {
    const arm = box(0.16, 0.18, 0.7, myArmMat, 0.06);
    arm.position.set(sx * 0.62, 0.58, 2.45);
    root.add(arm);
  }

  // Floor lamp
  const lampGroup = new THREE.Group();
  lampGroup.position.set(-1.25, 0, -1.95);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.55, 8), std(0x1a120c, { metalness: 0.6 }));
  pole.position.y = 0.78;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 24), std(0x1a120c, { metalness: 0.6 }));
  const lampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.24, 0.3, 32, 1, true),
    std(0xf3dcb8, { emissive: 0xffb46b, emissiveIntensity: 0.9, side: THREE.DoubleSide }),
  );
  lampShade.position.y = 1.6;
  lampGroup.add(pole, foot, lampShade);
  root.add(lampGroup);

  // Plant
  const plant = new THREE.Group();
  plant.position.set(2.25, 0, -2.25);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.42, 24), std(0x3b3530, { roughness: 0.9 }));
  pot.position.y = 0.21;
  pot.castShadow = true;
  plant.add(pot);
  const leafMat = std(0x3d5a34, { roughness: 0.8 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), leafMat);
    leaf.scale.set(0.45, 1.7, 0.18);
    const lift = 0.62 + (i % 4) * 0.22;
    leaf.position.set(Math.cos(a) * 0.16, lift, Math.sin(a) * 0.16);
    leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  root.add(plant);

  // Ceiling motif: a recessed amber ring above the conversation, always present
  const ceilingRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.02, 12, 96),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.35 }),
  );
  ceilingRing.rotation.x = Math.PI / 2;
  ceilingRing.position.set(0, h - 0.02, -0.6);
  root.add(ceilingRing);

  // Original-moment anchor: ring behind Alex + floor ring (hidden until Hold)
  const anchorRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.006, 8, 128),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0, depthWrite: false }),
  );
  anchorRing.position.set(0, 1.0, -0.92);
  anchorRing.name = 'OriginalAnchorRing';
  const floorRing = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.17, 128),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.set(0, 0.012, -0.55);
  const quoteAnchor = new THREE.Object3D();
  quoteAnchor.position.set(0, 0.42, -0.25);
  root.add(anchorRing, floorRing, quoteAnchor);

  // Hypothetical panels, left (A) and right (B), rising from brass floor slots
  const panels = {
    A: buildPanel('A', -1.62, -0.6, 0.42),
    B: buildPanel('B', 1.62, -0.6, -0.42),
  };
  for (const p of Object.values(panels)) root.add(p.group, p.slot);

  // Lights
  const base = { hemi: 0.55, ambient: 0.12, sun: 2.4, lamp: 5.5, face: 9 };
  const hemi = new THREE.HemisphereLight(0xffd9b0, 0x2a1a12, base.hemi);
  const ambient = new THREE.AmbientLight(0xffe2c4, base.ambient);
  const sun = new THREE.DirectionalLight(0xffa86a, base.sun);
  sun.position.set(2.2, 3.4, -6);
  sun.target.position.set(0, 0.6, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.bias = -0.0005;
  const lamp = new THREE.PointLight(0xffb46b, base.lamp, 6, 2);
  lamp.position.set(-1.25, 1.55, -1.95);
  const face = new THREE.SpotLight(0xffd6b0, base.face, 7, 0.42, 0.8, 1.6);
  face.position.set(0.7, 2.5, 1.7);
  face.target.position.set(0, 1.0, -0.8);
  const tint = new THREE.PointLight(PATH_COLOR.A, 0, 4, 2);
  tint.position.set(0, 1.4, -0.1);
  const anchorGlow = new THREE.PointLight(AMBER, 0, 3, 2);
  anchorGlow.position.set(0, 1.0, -0.6);
  root.add(hemi, ambient, sun, sun.target, lamp, face, face.target, tint, anchorGlow);

  return {
    root,
    lights: { hemi, ambient, sun, lamp, face, tint, anchorGlow },
    base,
    lampShade,
    ceilingRing,
    anchorRing,
    floorRing,
    quoteAnchor,
    panels,
    landmarks: { window: windowMarker, table, mug, plant, alexChair, lamp: lampGroup },
  };
}
