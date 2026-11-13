// WebXR support: entering/leaving VR, controller rays, select and squeeze.
// Simple picture: each controller shoots an invisible laser. Whatever it touches
// lights up; pulling the trigger presses it. Squeezing the grip asks to pause.
import * as THREE from 'three';
import type { SceneView } from '../view3d/sceneView';

export interface XRHooks {
  onSqueeze: () => void;
  onSessionChange: (presenting: boolean) => void;
}

export async function vrSupported(): Promise<boolean> {
  try {
    return !!(navigator as Navigator & { xr?: XRSystem }).xr && (await navigator.xr!.isSessionSupported('immersive-vr'));
  } catch {
    return false;
  }
}

export class XRSupport {
  private session: XRSession | null = null;
  private controllers: Array<{ ctrl: THREE.Group; ray: THREE.Line; dot: THREE.Mesh; id: string }> = [];
  private shadowTick = 0;

  constructor(private view: SceneView, private hooks: XRHooks) {
    const r = view.renderer;
    for (const i of [0, 1]) {
      const ctrl = r.xr.getController(i);
      const id = `xr${i}`;
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.7 }),
      );
      ray.scale.z = 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd27f }));
      dot.visible = false;
      ctrl.add(ray);
      view.scene.add(dot);
      // Controllers live inside the seat rig so their rays line up with the headset.
      view.rig.add(ctrl);
      ctrl.addEventListener('selectstart', () => this.select(i));
      ctrl.addEventListener('squeezestart', () => this.hooks.onSqueeze());
      ctrl.addEventListener('connected', () => (ctrl.visible = true));
      ctrl.addEventListener('disconnected', () => (ctrl.visible = false));
      this.controllers.push({ ctrl, ray, dot, id });
    }
    r.xr.addEventListener('sessionstart', () => this.onStart());
    r.xr.addEventListener('sessionend', () => this.onEnd());
    view.onBeforeRender(() => this.frame());
  }

  get presenting() {
    return this.view.renderer.xr.isPresenting;
  }

  async enter() {
    if (this.session) return;
    const session = await navigator.xr!.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
    this.session = session;
    await this.view.renderer.xr.setSession(session);
  }

  async exit() {
    await this.session?.end();
  }

  private onStart() {
    const r = this.view.renderer;
    // Comfort/performance for standalone headsets: fixed foveation, shadows refreshed less often.
    r.xr.setFoveation(1);
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    this.hooks.onSessionChange(true);
  }

  private onEnd() {
    this.session = null;
    this.view.renderer.shadowMap.autoUpdate = true;
    for (const c of this.controllers) this.view.pointAt(c.id, null);
    this.hooks.onSessionChange(false);
  }

  private tmpM = new THREE.Matrix4();
  private frame() {
    if (!this.presenting) return;
    if (++this.shadowTick % 6 === 0) this.view.renderer.shadowMap.needsUpdate = true;
    for (const c of this.controllers) {
      if (!c.ctrl.visible) continue;
      c.ctrl.updateMatrixWorld();
      this.tmpM.identity().extractRotation(c.ctrl.matrixWorld);
      const ray = new THREE.Ray(
        new THREE.Vector3().setFromMatrixPosition(c.ctrl.matrixWorld),
        new THREE.Vector3(0, 0, -1).applyMatrix4(this.tmpM).normalize(),
      );
      const hit = this.view.pointAt(c.id, ray);
      c.ray.scale.z = hit ? hit.distance : 2;
      (c.ray.material as THREE.LineBasicMaterial).opacity = hit ? 0.95 : 0.45;
      c.dot.visible = !!hit;
      if (hit) c.dot.position.copy(ray.at(hit.distance - 0.005, new THREE.Vector3()));
    }
  }

  private select(i: number) {
    const c = this.controllers[i];
    c.ctrl.updateMatrixWorld();
    this.tmpM.identity().extractRotation(c.ctrl.matrixWorld);
    const ray = new THREE.Ray(
      new THREE.Vector3().setFromMatrixPosition(c.ctrl.matrixWorld),
      new THREE.Vector3(0, 0, -1).applyMatrix4(this.tmpM).normalize(),
    );
    const hit = this.view.pointAt(c.id, ray);
    if (hit) hit.target.select(c.id, hit.uv);
  }
}
