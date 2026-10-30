// Water-surface animation for the shaded ground program, an artistic approximation tuned by eye.
// Time is the water clock's seconds (data/terrain/water-clock.ts): real time while the game runs, so the
// sea keeps one pace at every game speed. Every motion repeats a whole number of times per loop, so the
// clock wraps modulo the loop without a seam and the f32 `uWave.x` never loses `sin` precision.

/** Seconds after which every water motion is back where it started. */
export const WAVE_LOOP_SECONDS = 600;

const TAU = 2 * Math.PI;

/** A plane wave over world px: travel direction (normalised when emitted), wavelength, and whole
 *  cycles per {@link WAVE_LOOP_SECONDS}, the inverse of its period. */
interface WaterWave {
  readonly dirX: number;
  readonly dirY: number;
  readonly wavelengthPx: number;
  readonly cyclesPerLoop: number;
}

/** The baseline water's one swell, about 2.4 s; the enhanced water's swell leads with it too. */
const MAIN_SWELL: WaterWave = { dirX: 1, dirY: 0.9, wavelengthPx: 230, cyclesPerLoop: 251 };
/** The enhanced swell: the main one and two crossing it at unrelated angles, lengths and periods (about
 *  3.4 and 2 s, prime cycle counts), so their sum never settles into one band marching across the sea.
 *  Each weight is the wave's share of the displacement; they sum to one so the peak holds. */
const SWELLS: readonly { readonly wave: WaterWave; readonly weight: number }[] = [
  { wave: MAIN_SWELL, weight: 0.5 },
  { wave: { dirX: 1, dirY: -1.4, wavelengthPx: 310, cyclesPerLoop: 179 }, weight: 0.32 },
  { wave: { dirX: -0.35, dirY: 1, wavelengthPx: 170, cyclesPerLoop: 293 }, weight: 0.18 },
];
/** Peak vertical bob (world px) at full wave amplitude. */
const WAVE_AMPLITUDE_PX = 2;

/** The enhanced sea state: two broad slow waves (about 35 and 46 s) whose product drifts calm and rough
 *  patches across the water. */
const SEA_STATE: readonly [WaterWave, WaterWave] = [
  { dirX: 1, dirY: 0.4, wavelengthPx: 1100, cyclesPerLoop: 17 },
  { dirX: -0.5, dirY: 1, wavelengthPx: 1500, cyclesPerLoop: 13 },
];
/** The calmest patch keeps this share of the full swell and shimmer. */
const SEA_STATE_CALM = 0.35;

/** Peak brightness modulation of the water shimmer (fraction of the lane multiplier). */
export const WATER_SHIMMER_GAIN = 0.08;
/** The baseline shimmer: one fine travelling glint, about 2.4 s. */
const BASELINE_SHIMMER: WaterWave = { dirX: 1, dirY: 0.7, wavelengthPx: 95, cyclesPerLoop: 251 };

/**
 * A layer of the enhanced shimmer's noise: lattice cell size in world px, the lattice period in cells
 * after which the hash repeats, and the drift per loop in whole periods along x and y, so the drifted
 * pattern is back on itself when the clock wraps.
 */
interface NoiseLayer {
  readonly cellPx: number;
  readonly periodCells: number;
  readonly driftX: number;
  readonly driftY: number;
}
/** The shimmer's body: 110 px blobs drifting up-left at about 4 px/s. */
const SHIMMER_NOISE: NoiseLayer = { cellPx: 110, periodCells: 16, driftX: 1, driftY: 1 };
/** The warp bending the shimmer: broader blobs drifting right at about 3.5 px/s, across the body, so
 *  the pattern churns instead of sliding as one sheet. */
const WARP_NOISE: NoiseLayer = { cellPx: 260, periodCells: 8, driftX: -1, driftY: 0 };
/** How far the warp pushes the shimmer's lattice coordinates, in its cells. */
const WARP_STRENGTH = 0.6;
/** The detail octave's share of the shimmer noise; it samples the body at twice the frequency. */
const SHIMMER_DETAIL_SHARE = 0.35;
/** Contrast lifting the averaged noise, which crowds 0.5, to a full -1..1 swing. */
const SHIMMER_CONTRAST = 5;

/**
 * The swash on the enhanced water: along every shore the sea runs up the beach and draws back, a foam
 * line riding its edge and the sand it covered staying dark and wet a moment after. Positions on the
 * beach are shore values (data/terrain/water.ts), falling inland; the painted water edge often lies
 * seaward of the 0.5 mid-value, since a sand transition overlays the outermost water cells.
 */
const SWASH = {
  /** Run-ups per loop: one every 8 s. */
  cyclesPerLoop: 75,
  /** The shore value the sea draws back to and the one it runs up to. */
  back: 0.8,
  up: 0.5,
  /** Neighbouring stretches of beach surge at their own moments: a static noise of this cell size
   *  spreads the run-up's phase over this many radians. */
  surgeCellPx: 380,
  surgeSpread: 3 * Math.PI,
  /** How long, in radians of the run-up, the sand stays wet behind the retreating water. */
  wetLag: 1.4,
  /** Shore-value width of the wet edge's fade and of the foam line. */
  wetSoftness: 0.04,
  foamWidth: 0.07,
  /** Noise breaking the mesh's straight shore contours, in shore value, and its cell size. */
  jitter: 0.1,
  jitterCellPx: 30,
  /** Cell size of the noise that breaks the foam line into patches, and the noise band over which a
   *  patch fades from bare to full foam. */
  foamCellPx: 14,
  foamPatchLow: 0.35,
  foamPatchHigh: 0.65,
} as const;
/** Margin below 1 that an interpolated open-water shore value may fall short by. */
const SHORE_INTERPOLATION_SLACK = 0.01;
/** The shore values between which the swash can show: below, even the highest run-up with its jitter
 *  and foam stops short; at 1 lies open water. The ground shader skips the swash outside them. */
export const SWASH_SHORE_MIN = SWASH.up - SWASH.jitter / 2 - SWASH.foamWidth;
export const SWASH_SHORE_MAX = 1 - SHORE_INTERPOLATION_SLACK;
/** Seaward of the furthest the sea draws back to, with its jitter and foam, the wet sand fades out by
 *  SWASH_SHORE_MAX, so land paint beside open water shows no edge where the swash stops. */
const SWASH_WET_FADE_START = SWASH.back + SWASH.jitter / 2 + SWASH.foamWidth;
/** Lattice period of the static swash noises, in cells: large enough that no repeat shows. */
const STATIC_NOISE_PERIOD = 256;
/** Multiplier on wet sand: darker and a little cooler. */
export const SWASH_WET_TINT = [0.72, 0.78, 0.86] as const;
/** The foam's colour and how far it covers the ground at the line's centre. */
export const SWASH_FOAM_COLOUR = [0.9, 0.95, 0.94] as const;
export const SWASH_FOAM_STRENGTH = 0.35;

/** GLSL float literal. */
const f = (value: number): string => value.toFixed(8);

const waveRate = (wave: WaterWave): string => f((TAU * wave.cyclesPerLoop) / WAVE_LOOP_SECONDS);

function wavePhase(wave: WaterWave, pos: string, time: string): string {
  const perPx = TAU / wave.wavelengthPx / Math.hypot(wave.dirX, wave.dirY);
  return `(dot(${pos}, vec2(${f(wave.dirX * perPx)}, ${f(wave.dirY * perPx)})) + ${time} * ${waveRate(wave)})`;
}

/** GLSL for a noise layer's lattice coordinates at world `pos`, drifted to loop time `time`. */
function noiseCoords(layer: NoiseLayer, pos: string, time: string): string {
  const perSecond = layer.periodCells / WAVE_LOOP_SECONDS;
  return `(${pos} * ${f(1 / layer.cellPx)} + ${time} * vec2(${f(layer.driftX * perSecond)}, ${f(layer.driftY * perSecond)}))`;
}

/** Needs the `uWave` and `uEnhancedWater` uniforms. */
export const WATER_VERTEX_GLSL = `
  // The vertex's lift in world px; wave is its amplitude (0 on land and along the coast,
  // data/terrain/water.ts), scaled on the enhanced water by the sea state.
  float waterLift(vec2 p, float amplitude, out float wave) {
    wave = amplitude;
    float swell = sin(${wavePhase(MAIN_SWELL, 'p', 'uWave.x')});
    if (uEnhancedWater > 0.5) {
      float roughness = 0.5 + 0.5 * sin(${wavePhase(SEA_STATE[0], 'p', 'uWave.x')})
        * sin(${wavePhase(SEA_STATE[1], 'p', 'uWave.x')});
      wave *= mix(${f(SEA_STATE_CALM)}, 1.0, roughness);
      swell = ${SWELLS.map(({ wave, weight }) => `${f(weight)} * sin(${wavePhase(wave, 'p', 'uWave.x')})`).join(' + ')};
    }
    return wave * uWave.y * ${f(WAVE_AMPLITUDE_PX)} * swell;
  }
`;

/** Needs `uWave`, `uEnhancedWater` and `precision highp int` for the hash. */
export const WATER_FRAGMENT_GLSL = `
  // An integer hash to [0, 1].
  float waterHash(ivec2 cell) {
    uint h = uint(cell.x) * 0x8da6b343u ^ uint(cell.y) * 0xd8163841u;
    h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
    h ^= h >> 12u;
    return float(h & 0xffffu) / 65535.0;
  }

  // Value noise over lattice coordinates p, repeating every period cells.
  float waterNoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 t = fract(p);
    t = t * t * (3.0 - 2.0 * t);
    ivec2 a = ivec2(mod(i, period));
    ivec2 b = ivec2(mod(i + 1.0, period));
    return mix(mix(waterHash(a), waterHash(ivec2(b.x, a.y)), t.x),
      mix(waterHash(ivec2(a.x, b.y)), waterHash(b), t.x), t.y);
  }

  // The shimmer, -1..1: one travelling glint on the baseline water, domain-warped drifting noise on the
  // enhanced water, which shows no stripe and no period a player can follow.
  float waterShimmer(vec2 p) {
    if (uEnhancedWater > 0.5) {
      float warp = waterNoise(${noiseCoords(WARP_NOISE, 'p', 'uWave.x')}, ${f(WARP_NOISE.periodCells)});
      vec2 q = ${noiseCoords(SHIMMER_NOISE, 'p', 'uWave.x')} + ${f(WARP_STRENGTH)} * (warp - 0.5) * 2.0;
      float n = mix(waterNoise(q, ${f(SHIMMER_NOISE.periodCells)}),
        waterNoise(q * 2.0, ${f(SHIMMER_NOISE.periodCells * 2)}), ${f(SHIMMER_DETAIL_SHARE)});
      return clamp((n - 0.5) * ${f(SHIMMER_CONTRAST)}, -1.0, 1.0);
    }
    return sin(${wavePhase(BASELINE_SHIMMER, 'p', 'uWave.x')});
  }

  // The swash at p: the shore value the sea reaches now, lower further up the beach; wetLine is the
  // furthest it reached over the last wetLag radians, which the wet sand keeps: the run-up's peak when
  // that falls inside the window, else the nearer of its two ends.
  float waterSwash(vec2 p, out float wetLine) {
    float surge = waterNoise(p * ${f(1 / SWASH.surgeCellPx)}, ${f(STATIC_NOISE_PERIOD)}) * ${f(SWASH.surgeSpread)};
    float phase = uWave.x * ${f((TAU * SWASH.cyclesPerLoop) / WAVE_LOOP_SECONDS)} + surge;
    float now = mix(${f(SWASH.up)}, ${f(SWASH.back)}, 0.5 + 0.5 * cos(phase));
    float before = mix(${f(SWASH.up)}, ${f(SWASH.back)}, 0.5 + 0.5 * cos(phase - ${f(SWASH.wetLag)}));
    wetLine = mod(phase - ${f(Math.PI)}, ${f(TAU)}) < ${f(SWASH.wetLag)} ? ${f(SWASH.up)} : min(now, before);
    return now;
  }

  // The swash's wetness (x) and foam cover (y) at p, whose interpolated shore value is shore and whose
  // paint is land to this degree.
  vec2 waterSwashCover(vec2 p, float shore, float land) {
    land *= 1.0 - smoothstep(${f(SWASH_WET_FADE_START)}, ${f(SWASH_SHORE_MAX)}, shore);
    shore += ${f(SWASH.jitter)} * (waterNoise(p * ${f(1 / SWASH.jitterCellPx)}, ${f(STATIC_NOISE_PERIOD)}) - 0.5);
    float wetLine;
    float line = waterSwash(p, wetLine);
    float wet = smoothstep(wetLine - ${f(SWASH.wetSoftness)}, wetLine + ${f(SWASH.wetSoftness)}, shore) * land;
    float patches = smoothstep(${f(SWASH.foamPatchLow)}, ${f(SWASH.foamPatchHigh)}, waterNoise(p * ${f(1 / SWASH.foamCellPx)}, ${f(STATIC_NOISE_PERIOD)}));
    float foam = (1.0 - smoothstep(0.0, ${f(SWASH.foamWidth)}, abs(shore - line))) * patches;
    return vec2(wet, foam);
  }
`;
