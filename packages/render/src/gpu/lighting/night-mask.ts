import type { Container, Renderer, RenderGroup, WebGLRenderer } from 'pixi.js';

/**
 * The night's lit mask: a second colour attachment of the offscreen world, red 0 unlit up to 1 where a
 * light-bearer shows (see `world-renderer/offscreen-world.ts`). Programs that declare the
 * {@link NIGHT_LIT_OUTPUT} output write it in the same draw as their colour, from the element's own
 * `aNight` (see `world-batch/shader.ts`), so whatever the painter draws later covers a bearer's mark
 * again. Only the lit layer writes it: everything drawn outside that layer, and any program inside it
 * without the output, draws with the mask's buffer off.
 */
export const NIGHT_LIT_OUTPUT = 'nightLit';
/** The draw buffer {@link NIGHT_LIT_OUTPUT} is bound at. */
export const NIGHT_LIT_LOCATION = 1;

interface MaskState {
  /** The lit layer's render group while a masked pass draws, else null. */
  lit: RenderGroup | null;
  /** How deep the running draw is inside the lit layer's group. */
  inside: number;
  /** Whether the bound target's second draw buffer is on, as the last `drawBuffers` call left it: Pixi
   *  turns every attachment on as it binds a target with several. */
  on: boolean;
  /** Whether the masked pass has cleared its target: a bind before that is the pass's own, whose clear
   *  must reach the mask; one after it is a rebind mid-pass, answered at once. */
  cleared: boolean;
  program: WebGLProgram | null;
  readonly writes: WeakMap<WebGLProgram, boolean>;
}

const states = new WeakMap<Renderer, MaskState>();

/**
 * Hook `renderer` once: the render group pipe tells when the lit layer's draws start and end, and every
 * program bind whether the program writes the mask. Undocumented Pixi behaviour, verified on pixi.js
 * 8.22, re-verify on a bump: a child render group draws through `renderPipes.renderGroup.execute`
 * within its parent's instructions; programs bind through `gl.useProgram` only when the program changes;
 * and a target with several attachments binds through `gl.drawBuffers` with every buffer on, then clears
 * through `gl.clear` when the render asks it to.
 */
function install(renderer: WebGLRenderer): MaskState {
  const held = states.get(renderer);
  if (held !== undefined) return held;
  const gl = renderer.gl;
  const state: MaskState = {
    lit: null,
    inside: 0,
    on: true,
    cleared: false,
    program: null,
    writes: new WeakMap(),
  };
  const maskOn = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT0 + NIGHT_LIT_LOCATION];
  const maskOff = [gl.COLOR_ATTACHMENT0, gl.NONE];
  states.set(renderer, state);
  const sync = (): void => {
    const program = state.program;
    let writes = false;
    if (state.inside > 0 && program !== null) {
      const known = state.writes.get(program);
      writes = known ?? gl.getFragDataLocation(program, NIGHT_LIT_OUTPUT) === NIGHT_LIT_LOCATION;
      if (known === undefined) state.writes.set(program, writes);
    }
    if (writes === state.on) return;
    drawBuffers(writes ? maskOn : maskOff);
  };
  const setDrawBuffers = gl.drawBuffers.bind(gl);
  const drawBuffers = (buffers: GLenum[]): void => {
    setDrawBuffers(buffers);
    state.on = buffers.length > NIGHT_LIT_LOCATION && buffers[NIGHT_LIT_LOCATION] !== gl.NONE;
  };
  gl.drawBuffers = (buffers: GLenum[]): void => {
    drawBuffers(buffers);
    if (state.lit !== null && state.cleared) sync();
  };
  const clear = gl.clear.bind(gl);
  gl.clear = (mask: GLbitfield): void => {
    clear(mask);
    if (state.lit === null) return;
    state.cleared = true;
    sync();
  };
  const useProgram = gl.useProgram.bind(gl);
  gl.useProgram = (program: WebGLProgram | null): void => {
    state.program = program;
    useProgram(program);
    if (state.lit !== null && state.cleared) sync();
  };
  const pipe = renderer.renderPipes.renderGroup;
  const execute = pipe.execute.bind(pipe);
  pipe.execute = (group: RenderGroup): void => {
    if (state.lit === null) {
      execute(group);
      return;
    }
    const lit = group === state.lit;
    if (lit) state.inside++;
    sync();
    try {
      execute(group);
    } finally {
      if (lit) {
        state.inside--;
        sync();
      }
    }
  };
  return state;
}

/** Draw `render` with `lit`'s layer writing the mask of the target it binds, which must carry the mask
 *  at {@link NIGHT_LIT_LOCATION} and be cleared by the render. `lit` must be a render group. */
export function renderMasked(renderer: WebGLRenderer, lit: Container, render: () => void): void {
  const group = lit.renderGroup;
  if (group === null) throw new Error('The night mask needs its lit layer to be a render group');
  const state = install(renderer);
  state.lit = group;
  state.inside = 0;
  state.cleared = false;
  try {
    render();
  } finally {
    state.lit = null;
  }
}
