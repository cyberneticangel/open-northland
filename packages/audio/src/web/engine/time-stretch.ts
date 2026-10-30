/**
 * Speech sped up without raising its pitch, by waveform-similarity overlap-add (WSOLA): Hann frames
 * laid at a fixed output hop are taken from the input at `rate` times that hop, each nudged within a
 * small window to the offset whose start best continues the frame before it. Frame, search and
 * decimation sizes are approximations tuned by ear for narrated speech, not taken from the original.
 */

/** One frame's length: long enough to hold a voiced pitch period of a low voice. */
export const STRETCH_FRAME_S = 0.04;
/** How far a frame may move from its nominal input position to line up with the one before. */
export const STRETCH_SEARCH_S = 0.01;
/** The coarse search compares averages over this many samples. */
const COARSE_STEP = 8;
/** The fine search compares every this many samples around the coarse best. */
const FINE_STRIDE = 2;

/** The `channels` played `rate` times faster at the same pitch; `rate` 1 answers them unchanged.
 *  Every channel takes the offsets found on their mixdown, so the stereo image holds. */
export function stretchChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  rate: number,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const frame = evenFrames(STRETCH_FRAME_S * sampleRate);
  if (rate === 1 || length < frame * 2) return channels.map((samples) => samples);
  const hop = frame / 2;
  const search = Math.round(STRETCH_SEARCH_S * sampleRate);
  const outLength = Math.round(length / rate);
  const window = hann(frame);
  const guide = mixdown(channels, length);
  const coarse = decimated(guide, COARSE_STEP);
  const out = channels.map(() => new Float32Array(outLength + frame));
  const last = length - frame;

  let previous = 0;
  for (let at = 0; at < outLength; at += hop) {
    const nominal = Math.round(at * rate);
    const from = at === 0 ? 0 : bestOffset(guide, coarse, previous + hop, nominal, search, hop, last);
    channels.forEach((samples, channel) => {
      const target = out[channel];
      if (target === undefined) return;
      const take = Math.min(frame, length - from);
      for (let i = 0; i < take; i++)
        target[at + i] = (target[at + i] ?? 0) + (samples[from + i] ?? 0) * (window[i] ?? 0);
    });
    previous = from;
  }
  return out.map((samples) => samples.subarray(0, outLength));
}

const evenFrames = (frames: number): number => 2 * Math.max(1, Math.round(frames / 2));

/** A periodic Hann window, whose copies at half its length sum to one. */
function hann(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  return window;
}

function mixdown(channels: readonly Float32Array[], length: number): Float32Array {
  const [first] = channels;
  if (channels.length === 1 && first !== undefined) return first;
  const mix = new Float32Array(length);
  for (const samples of channels) for (let i = 0; i < length; i++) mix[i] = (mix[i] ?? 0) + (samples[i] ?? 0);
  return mix;
}

function decimated(samples: Float32Array, step: number): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += samples[i * step + j] ?? 0;
    out[i] = sum / step;
  }
  return out;
}

/** The input position near `nominal` whose next `overlap` samples best match those at `continuation`,
 *  found coarsely on the decimated guide and refined around that at full rate. */
function bestOffset(
  guide: Float32Array,
  coarse: Float32Array,
  continuation: number,
  nominal: number,
  search: number,
  overlap: number,
  last: number,
): number {
  const low = Math.max(0, nominal - search);
  const high = Math.min(last, nominal + search);
  if (high <= low) return Math.min(Math.max(0, nominal), Math.max(0, last));
  const reference = Math.floor(continuation / COARSE_STEP);
  const span = Math.floor(overlap / COARSE_STEP);
  let best = low;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let candidate = low; candidate <= high; candidate += COARSE_STEP) {
    const score = dot(coarse, Math.floor(candidate / COARSE_STEP), reference, span, 1);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const fineLow = Math.max(low, best - COARSE_STEP);
  const fineHigh = Math.min(high, best + COARSE_STEP);
  bestScore = Number.NEGATIVE_INFINITY;
  for (let candidate = fineLow; candidate <= fineHigh; candidate++) {
    const score = dot(guide, candidate, continuation, overlap, FINE_STRIDE);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function dot(samples: Float32Array, a: number, b: number, length: number, stride: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += stride) sum += (samples[a + i] ?? 0) * (samples[b + i] ?? 0);
  return sum;
}
