export * from './bob-atlases.js';
export * from './building-tribe.js';
export * from './cadaver.js';
export * from './catalog/animal-locomotion.js';
export * from './catalog/carried-load-band.js';
export * from './catalog/legacy-house-names.js';
export * from './fingerprint/content.js';
export * from './fingerprint/fnv.js';
export * from './fingerprint/json.js';
export * from './fingerprint/terrain.js';
export * from './footprint.js';
export * from './ground-lattice.js';
export * from './harvest-objects.js';
export * from './job-atomics.js';
export * from './languages.js';
export * from './lookup.js';
export * from './map-lobby.js';
export * from './missions/index.js';
export { PERSONAL_NAMES } from './names/index.js';
export * from './schema/catalog/browse.js';
export * from './schema/catalog/conversion.js';
export * from './schema/catalog/entry.js';
export * from './schema/catalog/id.js';
export * from './schema/index.js';
export * from './schema/report/report.js';
export * from './technology.js';

import { validateCrossReferences } from './cross-references/validate.js';
import { ContentSet, TerrainMapFile } from './schema/index.js';

/** Parse and validate one assembled content set; throws a zod error with a readable path. */
export function parseContentSet(raw: unknown): ContentSet {
  const set = ContentSet.parse(raw);
  validateCrossReferences(set);
  return set;
}

/** Parse the content set the pipeline generated (`content/ir.json`). The pipeline writes every lane, so
 *  a document missing one was written by another build and is rejected rather than loaded without it. */
export function parseGeneratedContentSet(raw: unknown): ContentSet {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const missing = Object.keys(ContentSet.shape).filter((lane) => !Object.hasOwn(raw, lane));
    if (missing.length > 0) {
      throw new Error(`generated content lacks ${missing.join(', ')}: regenerate it with this build`);
    }
  }
  return parseContentSet(raw);
}

/**
 * Parse and validate one decoded terrain grid file (`content/maps/<id>.json`). The loader boundary:
 * the `typeIds.length === width * height` invariant is checked here, outside the pure sim, so a
 * malformed file fails at load rather than as an out-of-bounds read in `buildTerrainGraph`.
 */
export function parseTerrainMap(raw: unknown): TerrainMapFile {
  return TerrainMapFile.parse(raw);
}

export { hasHumanForm, type UnitIdentity, unitVariantFor } from './unit-variants.js';
