/** Longest real step one frame may add, so a hitch or a hidden tab resumes the swell where it left off
 *  instead of jumping. Below 10 frames per second the sea slows with the frame rate. */
const MAX_FRAME_STEP_SECONDS = 0.1;

/**
 * The water surface's clock, in seconds. It runs at real time unless the game is paused, so the sea
 * keeps one pace at every game speed and through a late tick, and freezes with a pause. A frame with no
 * real clock (a still capture) reads the game clock instead, so the capture reproduces.
 */
export class WaterClock {
  private seconds = 0;
  private lastRealSeconds: number | undefined;

  advance(gameSeconds: number, realSeconds: number | undefined, paused: boolean): number {
    if (realSeconds === undefined) {
      this.lastRealSeconds = undefined;
      this.seconds = gameSeconds;
      return this.seconds;
    }
    const lastReal = this.lastRealSeconds;
    this.lastRealSeconds = realSeconds;
    if (lastReal !== undefined && !paused) {
      this.seconds += Math.min(Math.max(realSeconds - lastReal, 0), MAX_FRAME_STEP_SECONDS);
    }
    return this.seconds;
  }
}
