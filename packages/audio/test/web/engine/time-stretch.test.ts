import { describe, expect, it } from 'vitest';
import { stretchChannels } from '../../../src/web/engine/time-stretch.js';

const SAMPLE_RATE = 44100;
const TONE_HZ = 220;
const SECONDS = 2;

function tone(seconds: number, hz: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  return samples;
}

/** Upward zero crossings per second over the middle half, away from the ramps at either end. */
function pitchHz(samples: Float32Array): number {
  const from = Math.floor(samples.length / 4);
  const to = Math.floor((samples.length * 3) / 4);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) crossings++;
  return crossings / ((to - from) / SAMPLE_RATE);
}

describe('stretchChannels', () => {
  it('answers the clip unchanged at the recorded tempo', () => {
    const samples = tone(SECONDS, TONE_HZ);
    expect(stretchChannels([samples], SAMPLE_RATE, 1)[0]).toBe(samples);
  });

  it('shortens the clip by the tempo and keeps its pitch and level', () => {
    for (const rate of [1.25, 1.5, 2]) {
      const [out] = stretchChannels([tone(SECONDS, TONE_HZ)], SAMPLE_RATE, rate);
      if (out === undefined) throw new Error('no channel');
      expect(out.length).toBe(Math.round((SECONDS * SAMPLE_RATE) / rate));
      expect(pitchHz(out)).toBeCloseTo(TONE_HZ, -1);
      const middle = out.subarray(out.length / 4, (out.length * 3) / 4);
      expect(Math.max(...middle)).toBeCloseTo(1, 1);
    }
  });

  it('stretches every channel alike', () => {
    const left = tone(SECONDS, TONE_HZ);
    const out = stretchChannels([left, left.slice()], SAMPLE_RATE, 1.5);
    expect(out[1]).toEqual(out[0]);
  });
});
