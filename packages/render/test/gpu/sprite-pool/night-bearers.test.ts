import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SelectionSprite } from '../../../src/gpu/selection/sprite-effect.js';
import { NightBearers } from '../../../src/gpu/sprite-pool/night-bearers.js';
import type { PooledEntity } from '../../../src/gpu/sprite-pool/pooled-entity.js';
import { NIGHT_FALL_BAND } from '../../../src/gpu/world-batch/shader.js';

/** A plain entity with a body layer and a cast shadow the picker skips. */
function bearer(): { pe: PooledEntity; body: SelectionSprite; shadow: SelectionSprite } {
  const body = new SelectionSprite(Texture.WHITE);
  const shadow = new SelectionSprite(Texture.WHITE);
  const pe = {
    container: new Container(),
    paletted: false,
    sprites: [body, shadow],
    pickExempt: [false, true],
  };
  return { pe: pe as unknown as PooledEntity, body, shadow };
}

describe('NightBearers', () => {
  it('marks the body layers with their share, the shadow unlit, a house in the falling band', () => {
    const bearers = new NightBearers();
    const { pe, body, shadow } = bearer();
    bearers.begin();
    bearers.mark(pe, 0.5, false);
    bearers.end();
    expect([body.nightLit, shadow.nightLit]).toEqual([0.5, 0]);
    bearers.begin();
    bearers.mark(pe, 0.5, true);
    bearers.end();
    expect(body.nightLit).toBe(NIGHT_FALL_BAND + 0.5);
  });

  it('steps a fading share, so a frame that moves it a hair repacks nothing', () => {
    const bearers = new NightBearers();
    const { pe, body } = bearer();
    bearers.begin();
    bearers.mark(pe, 0.5001, false);
    bearers.end();
    expect(body.nightLit).toBe(0.5);
  });

  it('returns a bearer a frame left out to unlit', () => {
    const bearers = new NightBearers();
    const { pe, body } = bearer();
    bearers.begin();
    bearers.mark(pe, 0.8, false);
    bearers.end();
    bearers.begin();
    bearers.end();
    expect(body.nightLit).toBe(0);
  });
});
