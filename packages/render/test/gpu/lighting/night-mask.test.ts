import { Container, type RenderGroup, type WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { NIGHT_LIT_LOCATION, renderMasked } from '../../../src/gpu/lighting/night-mask.js';

const COLOR_ATTACHMENT0 = 0x8ce0;
const NONE = 0;
const WRITER = { name: 'writer' } as unknown as WebGLProgram;
const PLAIN = { name: 'plain' } as unknown as WebGLProgram;

/** A renderer whose context logs draw buffer calls, and whose render group pipe runs a group's draws. */
function fakeRenderer() {
  const calls: GLenum[][] = [];
  const gl = {
    COLOR_ATTACHMENT0,
    NONE,
    drawBuffers: (buffers: GLenum[]) => calls.push([...buffers]),
    clear: (_mask: GLbitfield) => {},
    useProgram: (_program: WebGLProgram | null) => {},
    getFragDataLocation: (program: WebGLProgram) => (program === WRITER ? NIGHT_LIT_LOCATION : -1),
  };
  const draws = new Map<RenderGroup, () => void>();
  const renderGroup = { execute: (group: RenderGroup) => draws.get(group)?.() };
  const renderer = { gl, renderPipes: { renderGroup } } as unknown as WebGLRenderer;
  return { renderer, gl, calls, draws, renderGroup };
}

const off = [COLOR_ATTACHMENT0, NONE];
const on = [COLOR_ATTACHMENT0, COLOR_ATTACHMENT0 + NIGHT_LIT_LOCATION];

describe('renderMasked', () => {
  it('leaves the bind-time buffers on for the clear, and writes the mask only inside the lit layer', () => {
    const { renderer, gl, calls, draws, renderGroup } = fakeRenderer();
    const world = new Container({ isRenderGroup: true });
    const lit = new Container({ isRenderGroup: true });
    world.addChild(lit);
    const worldGroup = world.renderGroup as RenderGroup;
    const litGroup = lit.renderGroup as RenderGroup;
    const log: string[] = [];
    draws.set(worldGroup, () => {
      gl.useProgram(WRITER);
      log.push(`ground ${String(calls.at(-1))}`);
      renderGroup.execute(litGroup);
      log.push(`over ${String(calls.at(-1))}`);
    });
    draws.set(litGroup, () => {
      log.push(`bearer ${String(calls.at(-1))}`);
      gl.useProgram(PLAIN);
      log.push(`plain ${String(calls.at(-1))}`);
    });
    renderMasked(renderer, lit, () => {
      // Pixi binding the masked target: every buffer on, then the clear.
      gl.drawBuffers(on);
      expect(calls.at(-1)).toEqual(on);
      gl.clear(0);
      renderGroup.execute(worldGroup);
    });
    expect(log).toEqual([`ground ${off}`, `bearer ${on}`, `plain ${off}`, `over ${off}`]);
  });

  it('turns the mask off again when the target rebinds mid-pass with the program unchanged', () => {
    const { renderer, gl, calls, draws, renderGroup } = fakeRenderer();
    const world = new Container({ isRenderGroup: true });
    const worldGroup = world.renderGroup as RenderGroup;
    const lit = new Container({ isRenderGroup: true });
    world.addChild(lit);
    let afterRebind: GLenum[] | undefined;
    draws.set(worldGroup, () => {
      gl.useProgram(WRITER);
      gl.drawBuffers(on);
      afterRebind = calls.at(-1);
    });
    renderMasked(renderer, lit, () => {
      gl.drawBuffers(on);
      gl.clear(0);
      renderGroup.execute(worldGroup);
    });
    expect(afterRebind).toEqual(off);
  });

  it('refuses a lit layer that is no render group', () => {
    const { renderer } = fakeRenderer();
    expect(() => renderMasked(renderer, new Container(), () => {})).toThrow();
  });
});
