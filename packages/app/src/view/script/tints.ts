import { VERTEX_PALETTE_ENTRIES, type VertexPalette } from '@open-northland/data';
import { gradeLuma, type LightGrade, NEUTRAL_GRADE, shownGrade } from '@open-northland/render/data';
import type { SimEvent } from '@open-northland/sim';
import { loadVertexPalette } from '../../content/vertex-palette.js';
import type { SessionHost } from '../../session/index.js';

/** Share of the map's cells one palette index must cover to be the scene's tint rather than a local one. */
export const WHOLE_MAP_SHARE = 0.6;
/** The palette entry a cell never tinted holds: neutral grey. */
const NEUTRAL_INDEX = 0;
/** vertexcolors.pcx channels use 128 as neutral and multiply the lit colour. */
const NEUTRAL_CHANNEL = 128;
/** A scene channel this dark or darker divides a local tint as one palette step, not as zero. */
const MIN_SCENE_CHANNEL = 1 / NEUTRAL_CHANNEL;
const RGB = 3;
/** Share of a brightening local tint's excess over 1 the ground keeps under a scene tint. Tuned by eye. */
const LOCAL_GLOW_SHARE = 0.2;

/** A script's tint state, split into what grades the whole scene and what stays on the ground. */
export interface ScriptTintSplit {
  /** The palette colour the whole-map tint asks for; null for daylight or no whole-map tint. */
  readonly scene: LightGrade | null;
  /** RGB terrain multipliers per map cell over the scene's multiply, which is {@link scene} as the
   *  scene light shows it, clamped to 1; a cell of the whole-map tint is 1, so the ground brightens
   *  only as the scene pass does. */
  readonly colors: Float32Array;
}

function channels(color: number): LightGrade {
  return [
    ((color >>> 16) & 255) / NEUTRAL_CHANNEL,
    ((color >>> 8) & 255) / NEUTRAL_CHANNEL,
    (color & 255) / NEUTRAL_CHANNEL,
  ];
}

/** The palette index covering at least {@link WHOLE_MAP_SHARE} of `tints`, or null. */
function dominantIndex(tints: Uint8Array): number | null {
  const counts = new Uint32Array(VERTEX_PALETTE_ENTRIES);
  for (const value of tints) counts[value] = (counts[value] ?? 0) + 1;
  const needed = tints.length * WHOLE_MAP_SHARE;
  for (let index = 0; index < counts.length; index++) if ((counts[index] ?? 0) >= needed) return index;
  return null;
}

/**
 * The dominant index is the scene tint, the colour the script author gave the whole map. Every other
 * index is a local tint, its palette colour divided by the scene's multiply, so the product on screen
 * is the colour the script asked for. Under a darkening scene a brightening local tint (a fire's glow)
 * keeps {@link LOCAL_GLOW_SHARE} of its excess instead: the night lights brighten it again, and divided
 * it would blow out under them. The dominant index and the neutral entry leave the ground at 1.
 * `pinned` replaces the dominant index (`?tint=`); `out` is reused when it fits.
 */
export function splitScriptTints(
  tints: Uint8Array,
  palette: readonly number[],
  out?: Float32Array,
  pinned: number | null = null,
): ScriptTintSplit {
  const colors = out?.length === tints.length * RGB ? out : new Float32Array(tints.length * RGB);
  const sceneIndex = pinned ?? dominantIndex(tints);
  const sceneColor = sceneIndex === null ? undefined : palette[sceneIndex];
  const scene = sceneIndex !== NEUTRAL_INDEX && sceneColor !== undefined ? channels(sceneColor) : null;
  const grade = scene === null ? NEUTRAL_GRADE : shownGrade(scene, [1, 1, 1]);
  const darkened = gradeLuma(grade) < 1;
  const byIndex = new Float32Array(VERTEX_PALETTE_ENTRIES * RGB);
  for (let index = 0; index < VERTEX_PALETTE_ENTRIES; index++) {
    const color = palette[index];
    const local =
      index === NEUTRAL_INDEX || index === sceneIndex || color === undefined ? null : channels(color);
    const glows = darkened && local !== null && gradeLuma(local) > 1;
    for (let c = 0; c < RGB; c++) {
      const want = local?.[c] ?? 1;
      byIndex[index * RGB + c] =
        local === null
          ? 1
          : glows
            ? 1 + (want - 1) * LOCAL_GLOW_SHARE
            : want / Math.max(MIN_SCENE_CHANNEL, Math.min(1, grade[c] ?? 1));
    }
  }
  for (let cell = 0; cell < tints.length; cell++) {
    const from = (tints[cell] ?? NEUTRAL_INDEX) * RGB;
    const to = cell * RGB;
    colors[to] = byIndex[from] ?? 1;
    colors[to + 1] = byIndex[from + 1] ?? 1;
    colors[to + 2] = byIndex[from + 2] ?? 1;
  }
  return { scene, colors };
}

/**
 * Per-node RGB multipliers from per-cell ones on a map `columns` cells wide: each cell's colour on its
 * corner node `(2c + (r & 1), 2r)`, every other node neutral. The ground mesh's vertices are those
 * corners, so the GPU shades each triangle between its three corner colours as the original does.
 */
export function cellColorsToCorners(
  cellColors: Float32Array,
  columns: number,
  out?: Float32Array,
): Float32Array {
  const rows = columns === 0 ? 0 : cellColors.length / RGB / columns;
  const nodesX = 2 * columns;
  const size = nodesX * 2 * rows * RGB;
  const colors = out?.length === size ? out : new Float32Array(size);
  colors.fill(1);
  for (let cy = 0; cy < rows; cy++) {
    const hy = 2 * cy;
    for (let cx = 0; cx < columns; cx++) {
      const from = (cy * columns + cx) * RGB;
      const to = (hy * nodesX + 2 * cx + (cy & 1)) * RGB;
      for (let c = 0; c < RGB; c++) colors[to + c] = cellColors[from + c] ?? 1;
    }
  }
  return colors;
}

interface ScriptTintSurface {
  /** `snap` takes the grade at once instead of fading: the state the world was loaded in. */
  setSceneLight(target: LightGrade | null, snap?: boolean): void;
  applyTerrainVertexColors(colors: Float32Array): void;
}

/** The map's tints kept on the surface: the author's and the script's, synced on the script's events,
 *  and never after `dispose`. */
export interface ScriptTints {
  readonly onEvents: (events: readonly SimEvent[]) => void;
  readonly dispose: () => void;
}

export interface ScriptTintOptions {
  /** `?tint=`: the palette index held as the whole-map tint in this view. */
  readonly pinnedIndex?: number | null;
}

export async function mountScriptTints(
  host: Pick<SessionHost, 'missions' | 'landscapeEdits'>,
  surface: ScriptTintSurface,
  { pinnedIndex = null }: ScriptTintOptions = {},
): Promise<ScriptTints> {
  const scripted =
    host.missions?.missions.some((mission) =>
      mission.results.some((op) => op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand'),
    ) === true;
  // The palette is fetched once, and only for a map whose author or script tints a cell.
  let paletteLoad: Promise<VertexPalette | null> | null = null;
  const paletteFor = (tints: Uint8Array): Promise<VertexPalette | null> => {
    if (paletteLoad === null) {
      const tinted = scripted || pinnedIndex !== null || tints.some((index) => index !== NEUTRAL_INDEX);
      paletteLoad = tinted ? loadVertexPalette() : Promise.resolve(null);
    }
    return paletteLoad;
  };
  let cellColors: Float32Array = new Float32Array(0);
  let nodeColors: Float32Array = new Float32Array(0);
  // Each answer is the whole tint state, so only the latest asked is applied, and none once disposed
  // or once the map proved to have no tint to show.
  let asked = 0;
  let disposed = false;
  let untinted = false;
  // The first answer applied is the state the world was loaded in, not a step to fade into, even
  // when a script's first-tick write made an earlier answer stale.
  let applied = false;
  const sync = (): void => {
    if (untinted) return;
    const request = ++asked;
    void host.landscapeEdits().then(async (edits) => {
      const palette = await paletteFor(edits.tints);
      untinted = palette === null;
      if (palette === null || request !== asked || disposed) return;
      const split = splitScriptTints(edits.tints, palette, cellColors, pinnedIndex);
      cellColors = split.colors;
      nodeColors = cellColorsToCorners(cellColors, edits.tintColumns, nodeColors);
      surface.setSceneLight(split.scene, !applied);
      applied = true;
      surface.applyTerrainVertexColors(nodeColors);
    });
  };
  sync();
  return {
    onEvents: (events) => {
      if (events.some((event) => event.kind === 'missionVertexColor')) sync();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
