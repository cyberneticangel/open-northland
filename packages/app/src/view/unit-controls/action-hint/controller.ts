import type { WorldSnapshot } from '@open-northland/sim';
import type { ModifierState } from '../../../hud/keybindings.js';
import type { HintLabel, HintLine } from './label.js';

export interface ActionHintOptions {
  readonly canvas: HTMLCanvasElement;
  readonly label: HintLabel;
  readonly camera: () => { readonly offsetX: number; readonly offsetY: number; readonly scale?: number };
  /** Each bumps when what the label reads changes under one snapshot. */
  readonly versions: readonly (() => number)[];
  /** Over the HUD, in a drag or a placement, the label yields. */
  readonly blocked: (clientX: number, clientY: number) => boolean;
  readonly lineAt: (clientX: number, clientY: number, mods: ModifierState) => HintLine | null;
  /** The player's setting; off, the label stays hidden and reads nothing. */
  readonly enabled: boolean;
}

/**
 * The label beside the cursor, read again only when the pointer, the snapshot, the camera, a version
 * or a held modifier changed, so a still cursor costs one comparison a frame.
 */
export function createActionHint(opts: ActionHintOptions): {
  update(snapshot: WorldSnapshot): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
} {
  const scope = new AbortController();
  let enabled = opts.enabled;
  let inside = false;
  let clientX = 0;
  let clientY = 0;
  const mods = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
  let dirty = true;
  let lastSnapshot: WorldSnapshot | null = null;
  let cameraX = 0;
  let cameraY = 0;
  let cameraScale = 1;
  const versions = opts.versions.map(() => -1);
  let line: HintLine | null = null;

  const versionsMoved = (): boolean => {
    let moved = false;
    for (let i = 0; i < opts.versions.length; i++) {
      const version = opts.versions[i]?.();
      if (versions[i] !== version) moved = true;
      versions[i] = version ?? -1;
    }
    return moved;
  };
  const hide = (): void => {
    dirty = true;
    opts.label.show(clientX, clientY, null);
  };
  const update = (snapshot: WorldSnapshot): void => {
    if (!enabled || !inside || opts.blocked(clientX, clientY)) {
      hide();
      return;
    }
    const camera = opts.camera();
    const scale = camera.scale ?? 1;
    const moved = versionsMoved();
    if (
      dirty ||
      moved ||
      lastSnapshot !== snapshot ||
      cameraX !== camera.offsetX ||
      cameraY !== camera.offsetY ||
      cameraScale !== scale
    ) {
      dirty = false;
      lastSnapshot = snapshot;
      cameraX = camera.offsetX;
      cameraY = camera.offsetY;
      cameraScale = scale;
      line = opts.lineAt(clientX, clientY, mods);
    }
    opts.label.show(clientX, clientY, line);
  };
  const readMods = (event: ModifierState): void => {
    if (
      mods.shiftKey === event.shiftKey &&
      mods.ctrlKey === event.ctrlKey &&
      mods.altKey === event.altKey &&
      mods.metaKey === event.metaKey
    )
      return;
    mods.shiftKey = event.shiftKey;
    mods.ctrlKey = event.ctrlKey;
    mods.altKey = event.altKey;
    mods.metaKey = event.metaKey;
    dirty = true;
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    dirty ||= !inside || clientX !== event.clientX || clientY !== event.clientY;
    inside = true;
    clientX = event.clientX;
    clientY = event.clientY;
    readMods(event);
  };
  const leave = (): void => {
    inside = false;
    hide();
  };
  const released = (): void => readMods({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
  opts.canvas.addEventListener('pointermove', move, { signal: scope.signal });
  opts.canvas.addEventListener('pointerenter', move, { signal: scope.signal });
  opts.canvas.addEventListener('pointerleave', leave, { signal: scope.signal });
  window.addEventListener('keydown', readMods, { signal: scope.signal });
  window.addEventListener('keyup', readMods, { signal: scope.signal });
  // A modifier let go in another window never reports its keyup here.
  window.addEventListener('blur', released, { signal: scope.signal });
  return {
    update,
    setEnabled: (next) => {
      enabled = next;
      if (!next) hide();
    },
    dispose: () => {
      scope.abort();
      opts.label.dispose();
    },
  };
}
