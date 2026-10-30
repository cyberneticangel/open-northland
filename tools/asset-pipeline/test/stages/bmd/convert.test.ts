import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AtlasAlphaMode, type BobAtlas, packBobAtlas } from '@open-northland/formats/atlas/index';
import {
  type Bmd,
  BOB_TYPE_1BIT,
  BOB_TYPE_DOUBLE8BIT,
  decodeBmd,
  encodeBmd,
} from '@open-northland/formats/bmd/index';
import type { BmdPaletteBinding, PaletteAlias } from '@open-northland/formats/ini';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packLineControl, sampleBmdBytes } from '../../../../../packages/formats/test/fixtures/bmd.js';
import { rampPalette, solidPalette } from '../../../../../packages/formats/test/fixtures/palette.js';
import { samplePcx } from '../../../../../packages/formats/test/fixtures/pcx.js';
import { encodeAtlasImage } from '../../../src/stages/atlas-image.js';
import { convertBmdTree, convertShadowBmdTree } from '../../../src/stages/bmd/index.js';
import { BOBS_DIR, BobAtlasCatalog } from '../../../src/stages/content-tree.js';
import { indexSourceAssets } from '../../../src/stages/source-files.js';
import { makeTempDir } from '../../support/game-tree.js';
import { decodeAtlasImage, readServedManifest, readServedSheet } from '../../support/served-atlas.js';

/** No stem the DOM shows: every bob set with several colourings shares an indexed sheet. */
const NO_DOM_PICTURES: ReadonlySet<string> = new Set();

/** `.bmd` bytes through a palette into the RGB atlas the stage writes for a bob set with one colouring. */
function bmdToAtlas(
  bytes: Uint8Array,
  palette: Uint8Array,
  alpha: AtlasAlphaMode = 'per-pixel',
  coverageBobs?: ReadonlySet<number>,
): BobAtlas {
  return packBobAtlas(decodeBmd(bytes), palette, { alpha, ...(coverageBobs ? { coverageBobs } : {}) });
}

describe('bmdToAtlas', () => {
  it('decodes a .bmd, packs an atlas, and yields an encodable image + manifest', async () => {
    const atlas = bmdToAtlas(sampleBmdBytes(), rampPalette());
    expect(atlas.manifest.frames).toHaveLength(1);
    const frame = atlas.manifest.frames[0];
    expect(frame?.bobId).toBe(10);
    expect(frame?.rect.width).toBe(2);
    expect(frame?.opaque).toBe(true);
    // The atlas image round-trips through the sheet encoder (proves it is a valid RGBA sheet).
    const decoded = await decodeAtlasImage(await encodeAtlasImage(atlas.image));
    expect(decoded.width).toBe(atlas.image.width);
    expect(decoded.height).toBe(atlas.image.height);
    // Manifest dimensions must agree with the image it describes.
    expect(atlas.manifest.width).toBe(atlas.image.width);
    expect(atlas.manifest.height).toBe(atlas.image.height);
  });

  it('propagates a bmd error for a non-CBobManager buffer (caught per-file by a tree walk)', () => {
    const notBmd = new Uint8Array(36);
    new DataView(notBmd.buffer).setUint32(0, 0x3e9, true); // CMemory id, not 0x3F4
    expect(() => bmdToAtlas(notBmd, rampPalette())).toThrow(/^bmd:/);
  });

  it('propagates an atlas error for a wrong-sized palette', () => {
    expect(() => bmdToAtlas(sampleBmdBytes(), new Uint8Array(100))).toThrow(/^atlas:/);
  });

  it('bakes Double8Bit per-pixel alpha, or opaque colour + a time sheet for the house build-time path', () => {
    // One type-4 bob, a 2x1 raw run of [index, second] pairs: [4, 0x60], [8, 0xff].
    const bmd: Bmd = {
      version: 0,
      firstBobId: 10,
      bobCount: 1,
      generatedNonEmptyLines: 0,
      generatedEmptyLines: 0,
      generatedPackedLines: 0,
      bobs: [{ type: BOB_TYPE_DOUBLE8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 }],
      packedLineData: Uint8Array.from([0x02, 4, 0x60, 8, 0xff, 0x00]),
      lineControl: Uint32Array.from([packLineControl(0, 0)]),
    };
    const bytes = encodeBmd(bmd);
    const graded = bmdToAtlas(bytes, rampPalette());
    const rect = graded.manifest.frames[0]?.rect;
    const alphaAt = (atlas: typeof graded, x: number): number =>
      atlas.image.rgba[((rect?.y ?? 0) * atlas.image.width + (rect?.x ?? 0) + x) * 4 + 3] ?? -1;
    expect(alphaAt(graded, 0)).toBe(0x60); // the alpha byte rides into the sheet
    expect(alphaAt(graded, 1)).toBe(0xff);
    const buildTime = bmdToAtlas(bytes, rampPalette(), 'build-time');
    expect(alphaAt(buildTime, 0)).toBe(0xff); // house colour plane replays the opaque blit
    expect(alphaAt(buildTime, 1)).toBe(0xff);
    // The second byte lands in the same-placement time sheet (grayscale threshold, alpha = written).
    expect(buildTime.timeImage).toBeDefined();
    const timeAt = (x: number, c: number): number =>
      buildTime.timeImage?.rgba[((rect?.y ?? 0) * buildTime.image.width + (rect?.x ?? 0) + x) * 4 + c] ?? -1;
    expect(timeAt(0, 0)).toBe(0x60);
    expect(timeAt(1, 0)).toBe(0xff);
    expect(timeAt(0, 3)).toBe(0xff);
    expect(graded.timeImage).toBeUndefined(); // the per-pixel bake emits no time sheet
    // A landscape bob in a house `.bmd` keeps its coverage; with no house bob left, no time sheet.
    const decor = bmdToAtlas(bytes, rampPalette(), 'build-time', new Set([10]));
    expect(alphaAt(decor, 0)).toBe(0x60);
    expect(decor.timeImage).toBeUndefined();
  });

  it('bakes a mixed house library: the house bob on the threshold, the decor bob on its coverage', () => {
    // Two type-4 bobs sharing one 2x1 run: bob 10 a house body, bob 11 decor no house draws.
    const pairs = [0x02, 4, 0x60, 8, 0xff, 0x00];
    const bmd: Bmd = {
      version: 0,
      firstBobId: 10,
      bobCount: 2,
      generatedNonEmptyLines: 0,
      generatedEmptyLines: 0,
      generatedPackedLines: 0,
      bobs: [
        { type: BOB_TYPE_DOUBLE8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 },
        { type: BOB_TYPE_DOUBLE8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 1 },
      ],
      packedLineData: Uint8Array.from([...pairs, ...pairs]),
      lineControl: Uint32Array.from([packLineControl(0, 0), packLineControl(0, pairs.length)]),
    };
    const atlas = bmdToAtlas(encodeBmd(bmd), rampPalette(), 'build-time', new Set([11]));
    expect(atlas.timeImage).toBeDefined();
    const [house, decor] = atlas.manifest.frames.map((f) => f.rect);
    const at = (image: typeof atlas.image | undefined, rect: typeof house, c: number): number =>
      image?.rgba[((rect?.y ?? 0) * atlas.image.width + (rect?.x ?? 0)) * 4 + c] ?? -1;
    expect(at(atlas.image, house, 3)).toBe(0xff);
    expect(at(atlas.timeImage, house, 0)).toBe(0x60);
    expect(at(atlas.image, decor, 3)).toBe(0x60);
    expect(at(atlas.timeImage, decor, 3)).toBe(0); // no threshold under the decor bob
  });
});

describe('convertBmdTree', () => {
  let out: string;
  let atlases: BobAtlasCatalog;

  beforeEach(async () => {
    out = (await makeTempDir('bmd')).path;
    atlases = new BobAtlasCatalog(out);
  });

  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });

  /** Lays down a palette `.pcx` and a body `.bmd` under <out> at MIXED-case paths (like the real lib). */
  const layDownAssets = async (): Promise<void> => {
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'Bear01.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Bobs', 'Body.bmd'), sampleBmdBytes());
  };

  /** A binding + palette index referencing the laid-down assets by their LOWER-cased (normalized) paths. */
  const sampleBinding = (): { bindings: BmdPaletteBinding[]; palettes: PaletteAlias[] } => ({
    bindings: [
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 2 },
    ],
    palettes: [{ name: 'bear01', gfxFile: 'data/pal/bear01.pcx' }],
  });

  it('resolves a binding to its palette .pcx + body .bmd and writes an atlas PNG + manifest', async () => {
    await layDownAssets();
    const { bindings, palettes } = sampleBinding();

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    expect(done).toHaveLength(1);
    // The atlas is served flat under bobs/ at the source's lower-cased basename, so the mixed-case
    // `Data/Bobs/Body.bmd` the refs resolved to never reaches the name; the palette editname rides in
    // it as the per-creature differentiator.
    expect(done[0]?.stem).toBe('body.bear01');
    expect(done[0]?.paletteName).toBe('bear01');
    // The manifest names the sheet it wrote, which decodes, and round-trips its frame table.
    const manifest = await readServedManifest(atlases, 'body.bear01');
    expect(done[0]?.image).toBe(`${BOBS_DIR}/${manifest.image}`);
    expect(manifest.image).toMatch(/^[0-9a-f]{16}\.webp$/);
    // A bob set with one colouring keeps its RGB sheet.
    expect(manifest.palette).toBeUndefined();
    const decoded = await readServedSheet(atlases, 'body.bear01');
    expect(decoded.width).toBeGreaterThan(0);
    expect(manifest.frames).toHaveLength(1);
    expect(manifest.frames[0]?.bobId).toBe(10);
    expect(manifest.width).toBe(decoded.width);
    expect(manifest.height).toBe(decoded.height);
  });

  it('writes a distinct atlas per palette when bindings share one body .bmd (per-creature recolour)', async () => {
    // The animals are one geometry recoloured per creature: many bindings collapse onto one body .bmd.
    // Naming on (bmd, palette) - not the .bmd alone - keeps each recolour its own file instead of
    // overwriting last-palette-wins.
    await layDownAssets();
    // A solid-red palette, distinguishable from the bear's ramp: without it the two carriers would be
    // byte-identical and the assertions below could not tell whose palette each atlas was coloured with.
    await writeFile(join(out, 'Data', 'Pal', 'Wolf01.pcx'), samplePcx(solidPalette(255, 0, 0)).bytes);
    const bindings: BmdPaletteBinding[] = [
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 2 },
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'wolf01', tribeId: 1, jobId: 3 },
    ];
    const palettes: PaletteAlias[] = [
      { name: 'bear01', gfxFile: 'data/pal/bear01.pcx' },
      { name: 'wolf01', gfxFile: 'data/pal/wolf01.pcx' },
    ];

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    expect(done).toHaveLength(2);
    // One shared indexed sheet, each stem's manifest naming it with its own palette.
    expect(new Set(done.map((c) => c.image)).size).toBe(1);
    const [bearManifest, wolfManifest] = await Promise.all(
      ['body.bear01', 'body.wolf01'].map((stem) => readServedManifest(atlases, stem)),
    );
    expect(bearManifest?.palette).toBeDefined();
    expect(bearManifest?.imageEncoding).toBe('index-coverage-png');
    expect(bearManifest?.image).toMatch(/^[0-9a-f]{16}\.png$/);
    expect(wolfManifest?.palette).not.toBe(bearManifest?.palette);
    expect(done.map((c) => c.stem).sort()).toEqual(['body.bear01', 'body.wolf01']);
    // Each atlas was coloured through its own binding's palette, not one shared pick: same geometry,
    // so any pixel difference is the palette, and the wolf's every colour is its solid-red carrier.
    const sheetPixel = async (stem: string): Promise<number[]> => {
      const { x, y } = (await readServedManifest(atlases, stem)).frames[0]?.rect ?? { x: 0, y: 0 };
      const img = await readServedSheet(atlases, stem);
      const o = (y * img.width + x) * 4;
      return [...img.rgba.subarray(o, o + 4)];
    };
    const bear = await sheetPixel('body.bear01');
    const wolf = await sheetPixel('body.wolf01');
    expect(wolf.slice(0, 3)).toEqual([255, 0, 0]);
    expect(bear).not.toEqual(wolf);
  });

  it('keeps an RGB sheet per palette for each stem the DOM shows, however many colourings its set has', async () => {
    // The goods' pile icons are CSS crops of their sheets, which show pixels as they are.
    await layDownAssets();
    await writeFile(join(out, 'Data', 'Bobs', 'LS_Goods.bmd'), sampleBmdBytes());
    await writeFile(join(out, 'Data', 'Pal', 'Wolf01.pcx'), samplePcx(solidPalette(255, 0, 0)).bytes);
    const bindings: BmdPaletteBinding[] = ['bear01', 'wolf01'].map((paletteName) => ({
      bmd: 'data/bobs/ls_goods.bmd',
      shadowBmd: undefined,
      paletteName,
      tribeId: 1,
      jobId: 2,
    }));
    const palettes: PaletteAlias[] = [
      { name: 'bear01', gfxFile: 'data/pal/bear01.pcx' },
      { name: 'wolf01', gfxFile: 'data/pal/wolf01.pcx' },
    ];

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      new Set(['ls_goods.bear01', 'ls_goods.wolf01']),
      [],
    );

    expect(new Set(done.map((c) => c.image)).size).toBe(2);
    for (const stem of ['ls_goods.bear01', 'ls_goods.wolf01'])
      expect((await readServedManifest(atlases, stem)).palette).toBeUndefined();
  });

  it('converts a repeated (bmd, palette) binding once, the base/mod legs overlap by design', async () => {
    await layDownAssets();
    const { palettes } = sampleBinding();
    // Same (bmd, palette) from two source legs; only the cross-refs differ.
    const bindings: BmdPaletteBinding[] = [
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 2 },
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 2, jobId: 3 },
    ];

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    expect(done.map((c) => c.stem)).toEqual(['body.bear01']);
  });

  it('serves a subdirectory .bmd flat under bobs/ (the mod ships building bobs under nowe/)', async () => {
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await mkdir(join(out, 'Data', 'Bobs', 'nowe'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'house.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Bobs', 'nowe', 'f_bakery.bmd'), sampleBmdBytes());

    const done = await convertBmdTree(
      {
        bindings: [
          {
            bmd: 'data/bobs/nowe/f_bakery.bmd',
            shadowBmd: undefined,
            paletteName: 'house',
            tribeId: 1,
            jobId: 2,
          },
        ],
        palettes: [{ name: 'house', gfxFile: 'data/pal/house.pcx' }],
        buildTimeBmds: new Set(),
        coverageBobs: new Map(),
      },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    // The app asks for the stem `f_bakery.house` - the source's `nowe/` subdirectory must not
    // reach the served name, or the mod's building bobs go missing and fall back.
    expect(done.map((d) => d.stem)).toEqual(['f_bakery.house']);
  });

  it('aborts when two convertible .bmd would claim one served atlas name', async () => {
    await layDownAssets();
    await mkdir(join(out, 'Data', 'Bobs', 'nowe'), { recursive: true });
    await writeFile(join(out, 'Data', 'Bobs', 'nowe', 'Body.bmd'), sampleBmdBytes());
    const { palettes } = sampleBinding();
    const bindings: BmdPaletteBinding[] = [
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 2 },
      { bmd: 'data/bobs/nowe/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 3 },
    ];

    await expect(
      convertBmdTree(
        { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
        atlases,
        await indexSourceAssets({ data: out }),
        NO_DOM_PICTURES,
        [],
      ),
    ).rejects.toThrow(/basename collision.*nowe\/body\.bmd/s);
  });

  it('does not abort on a same-named .bmd that no layer resolves, or on a shadow of that name', async () => {
    // Both are false collisions: an unresolvable ref writes nothing (it warns-and-skips below), and a
    // shadow atlas carries the fixed `shadow` suffix, so it can never meet a body's palette slug.
    await layDownAssets();
    const { palettes } = sampleBinding();
    const bindings: BmdPaletteBinding[] = [
      {
        bmd: 'data/bobs/body.bmd',
        shadowBmd: 'data/bobs/nowe/body.bmd',
        paletteName: 'bear01',
        tribeId: 1,
        jobId: 2,
      },
      { bmd: 'data/bobs/gone/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 3 },
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    expect(done.map((c) => c.stem)).toEqual(['body.bear01']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bmd data\/bobs\/gone\/body\.bmd not found/));
    warn.mockRestore();
  });

  it('skips a binding whose palette editname is not in the index, with a warning', async () => {
    await layDownAssets();
    const { bindings } = sampleBinding();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(
      { bindings, palettes: [], buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    ); // empty palette index

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unknown palette "bear01"/));
    warn.mockRestore();
  });

  it('skips a binding whose .bmd is missing under out, with a warning', async () => {
    // Palette .pcx present, body .bmd absent.
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'Bear01.pcx'), samplePcx().bytes);
    const { bindings, palettes } = sampleBinding();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bmd data\/bobs\/body\.bmd not found/));
    warn.mockRestore();
  });

  it('skips a binding whose .bmd is malformed, with a warning (one bad bob set does not abort)', async () => {
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'Bear01.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Bobs', 'Body.bmd'), new Uint8Array(8)); // not a CBobManager
    const { bindings, palettes } = sampleBinding();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped data\/bobs\/body\.bmd:/));
    warn.mockRestore();
  });
});

describe('convertShadowBmdTree', () => {
  let out: string;
  let atlases: BobAtlasCatalog;

  beforeEach(async () => {
    out = (await makeTempDir('bmd')).path;
    atlases = new BobAtlasCatalog(out);
  });

  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });

  /** One type-2 (1-bit mask) shadow bob - a raw run of 2 set pixels (pure RLE, no pixel bytes). */
  const shadowBmdBytes = (): Uint8Array =>
    encodeBmd({
      version: 0,
      firstBobId: 10,
      bobCount: 1,
      generatedNonEmptyLines: 0,
      generatedEmptyLines: 0,
      generatedPackedLines: 0,
      bobs: [{ type: BOB_TYPE_1BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 }],
      packedLineData: Uint8Array.from([0x02, 0x00]),
      lineControl: Uint32Array.from([packLineControl(0, 0)]),
    });

  const shadowBinding = (paletteName = 'bear01'): BmdPaletteBinding => ({
    bmd: 'data/bobs/body.bmd',
    shadowBmd: 'data/bobs/body_s.bmd',
    paletteName,
    tribeId: 1,
    jobId: 2,
  });

  const convert = async (bindings: BmdPaletteBinding[]): Promise<string[]> =>
    convertShadowBmdTree(
      { bindings, palettes: [], buildTimeBmds: new Set(), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
    );

  it('writes the `<shadow-basename>.shadow` stem - the name the app joins on', async () => {
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Bobs', 'Body_s.bmd'), shadowBmdBytes());

    const done = await convert([shadowBinding()]);

    // The literal `.shadow.` filenames are the contract `servedShadowStem` (packages/app) resolves
    // against - a drift here silently degrades to shadow-less rendering.
    const manifest = await readServedManifest(atlases, 'body_s.shadow');
    expect(done).toEqual([`${BOBS_DIR}/${manifest.image}`]);
    const decoded = await readServedSheet(atlases, 'body_s.shadow');
    expect(decoded.width).toBeGreaterThan(0);
    expect(manifest.frames).toHaveLength(1);
    expect(manifest.frames[0]?.bobId).toBe(10);
  });

  it('bakes one shared atlas when several recolour bindings name the same shadow .bmd', async () => {
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Bobs', 'Body_s.bmd'), shadowBmdBytes());

    const done = await convert([shadowBinding('bear01'), shadowBinding('wolf01')]);

    expect(done).toHaveLength(1); // deduped, not clobbered twice
  });

  it('skips a missing shadow .bmd with a warning; bindings without one are not shadow work at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convert([
      shadowBinding(),
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 3 },
    ]);

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1); // only the named-but-missing shadow warns
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/skipped shadow data\/bobs\/body_s\.bmd: not found/),
    );
    warn.mockRestore();
  });
});

describe('convertBmdTree build-time bake', () => {
  let out: string;
  let atlases: BobAtlasCatalog;

  beforeEach(async () => {
    out = (await makeTempDir('bmd')).path;
    atlases = new BobAtlasCatalog(out);
  });

  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });

  it('bakes a claimed .bmd opaque for EVERY palette; an unclaimed one keeps per-pixel alpha', async () => {
    // A Double8Bit bob with a graded alpha byte (0x40) - the observable the modes differ on.
    const doubleBmd: Bmd = {
      version: 0,
      firstBobId: 10,
      bobCount: 1,
      generatedNonEmptyLines: 0,
      generatedEmptyLines: 0,
      generatedPackedLines: 0,
      bobs: [{ type: BOB_TYPE_DOUBLE8BIT, area: { x: 0, y: 0, width: 1, height: 1 }, misc: 0 }],
      packedLineData: Uint8Array.from([0x01, 4, 0x40, 0x00]),
      lineControl: Uint32Array.from([packLineControl(0, 0)]),
    };
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'House01.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Pal', 'Ruins01.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Bobs', 'House.bmd'), encodeBmd(doubleBmd));
    await writeFile(join(out, 'Data', 'Bobs', 'Fern.bmd'), encodeBmd(doubleBmd));
    const bindings: BmdPaletteBinding[] = [
      // A [GfxHouse]-claimed bmd under TWO palettes (the landscape-twin case) + an unclaimed decal.
      {
        bmd: 'data/bobs/house.bmd',
        shadowBmd: undefined,
        paletteName: 'house01',
        tribeId: undefined,
        jobId: undefined,
      },
      {
        bmd: 'data/bobs/house.bmd',
        shadowBmd: undefined,
        paletteName: 'ruins01',
        tribeId: undefined,
        jobId: undefined,
      },
      {
        bmd: 'data/bobs/fern.bmd',
        shadowBmd: undefined,
        paletteName: 'house01',
        tribeId: undefined,
        jobId: undefined,
      },
    ];
    const palettes: PaletteAlias[] = [
      { name: 'house01', gfxFile: 'data/pal/house01.pcx' },
      { name: 'ruins01', gfxFile: 'data/pal/ruins01.pcx' },
    ];

    await convertBmdTree(
      { bindings, palettes, buildTimeBmds: new Set(['data/bobs/house.bmd']), coverageBobs: new Map() },
      atlases,
      await indexSourceAssets({ data: out }),
      NO_DOM_PICTURES,
      [],
    );

    const alphaOf = async (stem: string): Promise<number> => {
      const img = await readServedSheet(atlases, stem);
      return img.rgba[(1 * img.width + 1) * 4 + 3] ?? -1; // the 1x1 frame sits at the gutter origin
    };
    expect(await alphaOf('house.house01')).toBe(255); // claimed → opaque colour plane
    expect(await alphaOf('house.ruins01')).toBe(255); // ...for every recolour of that bmd
    expect(await alphaOf('fern.house01')).toBe(0x40); // unclaimed → per-pixel alpha survives

    // The claimed bmd's second byte lands in the time sheet the manifest names.
    const manifest = await readServedManifest(atlases, 'house.house01');
    expect(manifest.buildImage).toBeDefined();
    const timeSheet = await decodeAtlasImage(await readFile(join(out, BOBS_DIR, manifest.buildImage ?? '')));
    expect(timeSheet.rgba[(1 * timeSheet.width + 1) * 4] ?? -1).toBe(0x40); // the threshold, in R
    expect((await readServedManifest(atlases, 'fern.house01')).buildImage).toBeUndefined();
    // The two recolours share one palette here, so both sheets are byte-identical: one file each.
    const ruins = await readServedManifest(atlases, 'house.ruins01');
    expect([ruins.image, ruins.buildImage]).toEqual([manifest.image, manifest.buildImage]);
  });
});
