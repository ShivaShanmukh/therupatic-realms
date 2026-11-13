// Snapshot service: take one deep, frozen copy of the scene at M01,
// restore it exactly, and compare live vs saved field by field.
import type { SceneState, Snapshot } from './types';

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

export function cloneScene(scene: SceneState): SceneState {
  return structuredClone(scene) as SceneState;
}

export function takeSnapshot(args: Omit<Snapshot, 'scene'> & { scene: SceneState }): Snapshot {
  return deepFreeze({ ...args, scene: cloneScene(args.scene) });
}

/** A fresh, mutable copy of the saved scene. The snapshot itself is never handed out mutable. */
export function restoreScene(snapshot: Snapshot): SceneState {
  return cloneScene(snapshot.scene);
}

/** Returns a list of "path: saved → live" differences. Empty list = exact match. */
export function diffScene(saved: unknown, live: unknown, path = 'scene'): string[] {
  if (saved === live) return [];
  if (typeof saved !== 'object' || typeof live !== 'object' || saved === null || live === null) {
    return [`${path}: ${JSON.stringify(saved)} → ${JSON.stringify(live)}`];
  }
  const keys = new Set([...Object.keys(saved), ...Object.keys(live)]);
  const out: string[] = [];
  for (const k of keys) {
    out.push(
      ...diffScene(
        (saved as Record<string, unknown>)[k],
        (live as Record<string, unknown>)[k],
        `${path}.${k}`,
      ),
    );
  }
  return out;
}
