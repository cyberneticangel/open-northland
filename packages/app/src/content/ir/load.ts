import { type BobAtlasGeometry, decodeAtlasFrames } from '@open-northland/data';
import { decodeAtlasPalette } from '@open-northland/formats/atlas/paletted-sheet';
import {
  type AtlasSheetLayout,
  type BuildTimeSheet,
  indexAtlasFrames,
  registerRecolouredFrames,
  type SpriteAtlas,
  type SpriteLayer,
} from '@open-northland/render';
import { Texture, type TextureSource } from 'pixi.js';
import { loadAtlasSheet } from '../atlas-sheet/index.js';
import { loadServedBobAtlas } from '../bob-atlases.js';
import { withAddedHousePalettes } from '../building-gfx/added-palettes.js';
import { fetchImageData, fetchJsonOrNull } from '../net.js';
import { atlasImagePath } from '../url.js';
import { BODY_IMAGELIB, type BobSeqRow, type ContentIr } from './rows.js';

/**
 * The decoded atlas isn't served (the pipeline hasn't run, or `content/` is empty). The sheet loaders catch
 * only this to degrade to the synthetic markers; any other error propagates.
 */
export class MissingAtlasError extends Error {}

/** Indexed sheets (the pipeline emits every one as `<stem>.indexed`): palette index in red, coverage in
 *  green. */
function isIndexedStem(stem: string): boolean {
  return stem.endsWith('.indexed');
}

/** Every decoded atlas body in flight or settled, by served stem and sheet layout. */
const layerBodies = new Map<string, Promise<SpriteLayer>>();

/** Layers whose sheet could not be coloured: they draw nothing and the next caller tries again. */
const degradedLayers = new WeakSet<SpriteLayer>();

/** Indexed frames by geometry, then by the page they cut, then by recoloured stem. The renderer keys its
 *  texture views by frame object, so a frame names one page and one stem: palette twins share a geometry
 *  and a recoloured page but each has its own frames (even twins with equal palettes, whose sprite use
 *  the renderer tracks per stem), and stems sharing an RGB sheet share frames. */
const atlasByGeometry = new WeakMap<BobAtlasGeometry, WeakMap<TextureSource, Map<string, SpriteAtlas>>>();
/** The stem key of frames drawn without a palette. */
const NO_PALETTE = '';

/** `recolour`: the stem and its palette when the page is a recoloured one. */
function spriteAtlasOf(
  geometry: BobAtlasGeometry,
  source: TextureSource,
  recolour?: { readonly stem: string; readonly palette: string },
): SpriteAtlas {
  let byPage = atlasByGeometry.get(geometry);
  if (byPage === undefined) {
    byPage = new WeakMap();
    atlasByGeometry.set(geometry, byPage);
  }
  let byStem = byPage.get(source);
  if (byStem === undefined) {
    byStem = new Map();
    byPage.set(source, byStem);
  }
  const key = recolour?.stem ?? NO_PALETTE;
  let atlas = byStem.get(key);
  if (atlas === undefined) {
    atlas = indexAtlasFrames(geometry.width, geometry.height, decodeAtlasFrames(geometry));
    if (recolour !== undefined) {
      registerRecolouredFrames(atlas.frames.values(), decodeAtlasPalette(recolour.palette));
    }
    byStem.set(key, atlas);
  }
  return atlas;
}

/**
 * One decoded atlas body (the stem's entry in `bobs/atlases.json` and the sheet it names; a paletted
 * stem draws the shared recoloured page through its own palette). A sheet that cannot be read leaves an
 * empty page, so the stem draws nothing. A stem with a `buildImage` also reads that time sheet CPU-side for the
 * per-pixel construction-reveal thresholds, degrading to the crop reveal when unreadable.
 */
async function fetchLayerBody(stem: string, layout: AtlasSheetLayout): Promise<SpriteLayer> {
  const served = await loadServedBobAtlas(stem);
  if (served === null) {
    throw new MissingAtlasError(
      `atlas: decoded atlas '${stem}' not served. Run \`npm run build:content\` to populate content/.`,
    );
  }
  const { sheet, geometry } = served;
  const [source, times] = await Promise.all([
    loadAtlasSheet(sheet, layout),
    sheet.buildImage === undefined
      ? Promise.resolve(undefined)
      : loadBuildTimeSheet(atlasImagePath(sheet.buildImage)),
  ]);
  const page = source ?? Texture.EMPTY.source;
  const layer = {
    // An empty page stands in for a sheet that could not be read; it has no palette to draw through.
    atlas: spriteAtlasOf(
      geometry,
      page,
      source === undefined || sheet.palette === undefined ? undefined : { stem, palette: sheet.palette },
    ),
    source: page,
    ...(times !== undefined ? { times } : {}),
  };
  if (source === undefined) degradedLayers.add(layer);
  return layer;
}

/**
 * `fetchLayerBody` memoized per stem and layout. Handing out the same instance is safe: `atlas.frames` is a
 * `ReadonlyMap`, nothing writes `times.values` once it is filled, and no consumer destroys an atlas page's
 * `TextureSource`.
 */
function loadLayerBody(
  stem: string,
  layout: AtlasSheetLayout = isIndexedStem(stem) ? 'indexed' : 'rgba',
): Promise<SpriteLayer> {
  const key = `${layout}:${stem}`;
  const cached = layerBodies.get(key);
  if (cached !== undefined) return cached;
  const pending = fetchLayerBody(stem, layout);
  // Memoize only success, so a transient failure does not pin this stem to the fallback for the page's life.
  const forget = (): void => {
    if (layerBodies.get(key) === pending) layerBodies.delete(key);
  };
  pending.then((layer) => {
    if (degradedLayers.has(layer)) forget();
  }, forget);
  layerBodies.set(key, pending);
  return pending;
}

/**
 * One decoded atlas layer, optionally carrying the cast-shadow twin named by `shadowStem` (the pipeline's
 * `<shadow-bmd-stem>.shadow` atlas). A missing shadow degrades to a shadow-less layer rather than failing
 * the body.
 */
export async function loadLayer(stem: string, shadowStem?: string): Promise<SpriteLayer> {
  const shadowLoad =
    shadowStem === undefined
      ? undefined
      : loadLayerBody(shadowStem).catch((err: unknown) => {
          if (err instanceof MissingAtlasError) return undefined;
          throw err;
        });
  // Keep a shadow rejection from surfacing as unhandled while the body await is pending; the body's own
  // failure stays the one a caller sees.
  shadowLoad?.catch(() => undefined);
  const body = await loadLayerBody(stem);
  const shadow = await shadowLoad;
  return shadow === undefined ? body : { ...body, shadow };
}

/** A displacement effect's layer (a shore wave's `<stem>.indexed`): values in red, the written mask in
 *  alpha, loaded straight. */
export function loadDisplacementLayer(stem: string): Promise<SpriteLayer> {
  return loadLayerBody(stem, 'displacement');
}

/** Fetch a build-time sheet and keep its R channel (the 0–255 thresholds) CPU-side, or `undefined`
 *  when absent/unreadable. */
async function loadBuildTimeSheet(url: string): Promise<BuildTimeSheet | undefined> {
  const img = await fetchImageData(url);
  if (img === null) return undefined;
  const values = new Uint8Array(img.width * img.height);
  for (let i = 0; i < values.length; i++) values[i] = img.data[i * 4] ?? 0;
  return { width: img.width, height: img.height, values };
}

let contentIrPromise: Promise<unknown> | null = null;
const graphicsViews = new WeakMap<object, ContentIr>();

/**
 * Fetch and parse the served `content/ir.json` once per page - memoized, because it is multi-MB and every
 * domain reads its lanes from the same bytes. Returns `null` when absent or unreadable.
 */
export function loadIrRaw(): Promise<unknown> {
  contentIrPromise ??= fetchJsonOrNull<unknown>('/ir.json').then((raw) => {
    // Memoize only success, so the next consumer retries after a transient boot-time fetch failure.
    if (raw === null) contentIrPromise = null;
    return raw;
  });
  return contentIrPromise;
}

/**
 * The graphics/atlas view of the served IR, cast at the I/O boundary, with the house palettes the catalog
 * adds. `null` when the document is absent; each consumer then falls back per-lane.
 */
export async function loadIr(): Promise<ContentIr | null> {
  const raw = await loadIrRaw();
  if (raw === null) return null;
  // One view per fetched document, so consumers keyed on the IR's identity keep their caches.
  let ir = graphicsViews.get(raw as object);
  if (ir === undefined) {
    ir = withAddedHousePalettes(raw as ContentIr);
    graphicsViews.set(raw as object, ir);
  }
  return ir;
}

/**
 * Every `[bobseq]` of one body bob set, in file order - the frame ranges only, not the atlas image.
 * Returns `[]` when the IR is absent.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * A gallery character's layers: one body atlas plus N head atlases, given already-resolved served stems
 * (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`). An absent body throws
 * `MissingAtlasError`; a missing head degrades to `undefined` in its `heads` slot, which keeps stem order.
 * `bodyShadowStem` attaches the body's authored silhouette twin; no head bob has one.
 */
export async function loadGalleryLayers(
  bodyStem: string,
  headStems: readonly string[],
  bodyShadowStem?: string,
): Promise<{ body: SpriteLayer; heads: (SpriteLayer | undefined)[] }> {
  const bodyPromise = loadLayer(bodyStem, bodyShadowStem);
  const headsPromise = Promise.all(
    headStems.map((s) =>
      loadLayer(s).catch((err: unknown) => {
        if (err instanceof MissingAtlasError) return undefined;
        throw err;
      }),
    ),
  );
  const [body, heads] = await Promise.all([bodyPromise, headsPromise]);
  return { body, heads };
}
