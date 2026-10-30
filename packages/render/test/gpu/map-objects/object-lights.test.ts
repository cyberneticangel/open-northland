import { describe, expect, it } from 'vitest';
import { LightSiteList } from '../../../src/data/lighting/light-sites.js';
import type { MapObjectSprite } from '../../../src/gpu/map-objects/map-object-sprite.js';
import { ObjectLightIndex } from '../../../src/gpu/map-objects/object-lights.js';

const BLOCK_PX = 1000;
const object = (x: number, y: number, light?: 'fire'): MapObjectSprite =>
  ({ x, y, lift: 10, ...(light !== undefined ? { light } : {}) }) as unknown as MapObjectSprite;
const viewport = { minX: 0, minY: 0, maxX: 800, maxY: 600 };

describe('ObjectLightIndex', () => {
  it('collects the fires within reach of the view, lifted, and forgets removed ones', () => {
    const index = new ObjectLightIndex(BLOCK_PX);
    const near = object(400, 300, 'fire');
    index.add(near);
    index.add(object(500, 300));
    index.add(object(5000, 5000, 'fire'));
    const out = new LightSiteList();
    index.collect(viewport, out);
    expect(out.sites.map(({ kind, x, y }) => [kind, x, y])).toEqual([['fire', 400, 290]]);
    index.remove(near);
    out.clear();
    index.collect(viewport, out);
    expect(out.sites).toHaveLength(0);
  });

  it('skips a fire on ground the viewer has not explored', () => {
    const index = new ObjectLightIndex(BLOCK_PX);
    index.add(object(400, 300, 'fire'));
    const out = new LightSiteList();
    index.collect(viewport, out, () => false);
    expect(out.sites).toHaveLength(0);
  });
});
