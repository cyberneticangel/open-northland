import { buildingFootprintFor } from '@open-northland/data';
import { components, fx, nodeOfPosition, ONE, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PRIMARY_TRIBE } from '../../../src/game/rules.js';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { rangeRingsOf } from '../../../src/view/projections/index.js';
import { createWorkAreaOverlay } from '../../../src/view/unit-controls/work-area.js';
import { type Ent, idLookupVisits, snapshotOf, visitCountingSnapshot } from '../../support/snapshot.js';

/** The ground circles a selection shows: where its workers work, and where a defence-capable building shoots. */

const content = sandboxContent();
const jobOf = (slug: string): number => {
  const job = content.jobs.find((j) => j.id === slug);
  if (job === undefined) throw new Error(`no ${slug} job in the sandbox content`);
  return job.typeId;
};
const COLLECTOR = jobOf('collector');
const HUNTER = jobOf('hunter');
const FISHER = jobOf('fisher');
const CARRIER = jobOf('carrier');
const shelter = content.buildings.find((b) => (b.shelterCapacity ?? 0) > 0);
if (shelter === undefined) throw new Error('no defence-capable building in the sandbox content');
const noShelter = content.buildings.find((b) => (b.shelterCapacity ?? 0) === 0);
const doored = content.buildings.find((b) => buildingFootprintFor(b, PRIMARY_TRIBE)?.door !== undefined);
if (doored === undefined) throw new Error('no building with a door in the sandbox content');
if (noShelter === undefined) throw new Error('no building without defence mode in the sandbox content');
const store = content.buildings.find((b) => b.kind === 'storage' && (b.shelterCapacity ?? 0) === 0);
if (store === undefined) throw new Error('no store without defence mode in the sandbox content');
const workshop = content.buildings.find((b) => b.recipes.length > 0 && (b.shelterCapacity ?? 0) === 0);
if (workshop === undefined) throw new Error('no crafting workshop in the sandbox content');

const FLAG_RADIUS = 24;
const LODGE = 50;
const TOWER = 60;
const FLAG = 70;
const TOWER_AT = { x: fx.fromInt(10), y: fx.fromInt(10) };

const settler = (id: number, jobType: number, extra: Record<string, unknown> = {}): Ent => ({
  id,
  components: {
    Settler: { jobType, tribe: PRIMARY_TRIBE },
    Position: { x: id * ONE, y: id * ONE },
    ...extra,
  },
});
const building = (buildingType: number, extra: Record<string, unknown> = {}): Ent => ({
  id: TOWER,
  components: {
    Building: { buildingType, tribe: PRIMARY_TRIBE, built: ONE },
    Position: TOWER_AT,
    ...extra,
  },
});

describe('rangeRingsOf', () => {
  it('shows a temple blessing range while planning, damaged or complete, but no headquarters aura', () => {
    const temple = content.buildings.find((row) => row.prayerSite === 'temple');
    const headquarters = content.buildings.find((row) => row.prayerSite === 'headquarters');
    if (temple === undefined || headquarters === undefined) throw new Error('missing prayer sites');
    for (const extra of [{}, { Health: { hitpoints: 1, max: 100 } }, { UnderConstruction: { labor: 0 } }]) {
      expect(rangeRingsOf(content, snapshotOf([building(temple.typeId, extra)]), [TOWER])).toEqual([
        { entity: TOWER, radiusNodes: systems.TEMPLE_AURA_RANGE, metric: 'hex', kind: 'blessing' },
      ]);
    }
    expect(
      rangeRingsOf(content, snapshotOf([building(headquarters.typeId)]), [TOWER]).some(
        (ring) => ring.kind === 'blessing',
      ),
    ).toBe(false);
  });
  it("draws a flag gatherer's circle around its flag at the flag's radius", () => {
    const world = snapshotOf([settler(1, COLLECTOR, { WorkFlag: { flag: FLAG, radius: FLAG_RADIUS } })]);
    expect(rangeRingsOf(content, world, [1])).toEqual([
      { entity: FLAG, radiusNodes: FLAG_RADIUS, metric: 'manhattan', kind: 'work' },
    ]);
  });

  it('draws a fisher at his shore search, from his flag or short of it by his workplace door', () => {
    const world = snapshotOf([
      settler(1, FISHER, { WorkFlag: { flag: FLAG, radius: FLAG_RADIUS } }),
      settler(2, FISHER, { JobAssignment: { workplace: TOWER } }),
      building(doored.typeId),
    ]);
    const { hy } = nodeOfPosition(TOWER_AT.x, TOWER_AT.y);
    const fromDoor = systems.workplaceShoreSearchRadius(
      content,
      { buildingType: doored.typeId, tribe: PRIMARY_TRIBE },
      hy,
    );
    expect(fromDoor).toBeLessThan(systems.FISH_SHORE_SEARCH_RADIUS);
    expect(rangeRingsOf(content, world, [1, 2])).toEqual([
      { entity: FLAG, radiusNodes: systems.FISH_SHORE_SEARCH_RADIUS, metric: 'manhattan', kind: 'work' },
      { entity: TOWER, radiusNodes: fromDoor, metric: 'manhattan', kind: 'work' },
    ]);
  });

  it("draws a flag hunter's ground in map points around its flag", () => {
    const radius = components.HUNTER_WORK_FLAG_RADIUS;
    const world = snapshotOf([settler(1, HUNTER, { WorkFlag: { flag: FLAG, radius } })]);
    expect(rangeRingsOf(content, world, [1])).toEqual([
      { entity: FLAG, radiusNodes: radius, metric: 'hex', kind: 'work' },
    ]);
  });

  it('draws one circle for the hunters of one lodge, and none for an employed gatherer', () => {
    const world = snapshotOf([
      settler(1, HUNTER, { JobAssignment: { workplace: LODGE } }),
      settler(2, HUNTER, { JobAssignment: { workplace: LODGE } }),
      settler(3, COLLECTOR, { JobAssignment: { workplace: LODGE + 1 } }),
    ]);
    expect(rangeRingsOf(content, world, [1, 2, 3])).toEqual([
      { entity: LODGE, radiusNodes: components.HUNTER_WORK_FLAG_RADIUS, metric: 'hex', kind: 'work' },
    ]);
  });

  it("draws a defence-capable building's fire reach in its own kind, whether its alarm is up or not", () => {
    const { hx, hy } = nodeOfPosition(TOWER_AT.x, TOWER_AT.y);
    const reach = systems.shelterFireRadius(
      content,
      { buildingType: shelter.typeId, tribe: PRIMARY_TRIBE },
      hx,
      hy,
    );
    expect(reach).toBeGreaterThan(0);
    const ring = [{ entity: TOWER, radiusNodes: reach, metric: 'hex', kind: 'defence' }];
    expect(rangeRingsOf(content, snapshotOf([building(shelter.typeId)]), [TOWER])).toEqual(ring);
    expect(
      rangeRingsOf(content, snapshotOf([building(shelter.typeId, { DefenceMode: {} })]), [TOWER]),
    ).toEqual(ring);
    expect(rangeRingsOf(content, snapshotOf([building(noShelter.typeId)]), [TOWER])).toEqual([]);
  });

  it("draws a porter's pickup area around its store, from the porter or the store, while one holds no flag", () => {
    const area = [
      { entity: TOWER, radiusNodes: systems.WORKPLACE_COLLECT_RADIUS, metric: 'manhattan', kind: 'work' },
    ];
    const porter = settler(1, CARRIER, { JobAssignment: { workplace: TOWER } });
    const staffed = snapshotOf([porter, building(store.typeId)]);
    expect(rangeRingsOf(content, staffed, [1])).toEqual(area);
    expect(rangeRingsOf(content, staffed, [TOWER])).toEqual(area);
    expect(rangeRingsOf(content, snapshotOf([building(store.typeId)]), [TOWER])).toEqual([]);
    const flagged = settler(1, CARRIER, {
      JobAssignment: { workplace: TOWER },
      HaulFlag: { flag: FLAG, radius: FLAG_RADIUS },
    });
    expect(rangeRingsOf(content, snapshotOf([flagged, building(store.typeId)]), [TOWER])).toEqual([]);
  });

  it("draws a defence-capable store's fire reach over its porters' pickup area", () => {
    const fort = content.buildings.find(
      (b) => (b.shelterCapacity ?? 0) > 0 && systems.postCollectsAroundWorkplace(content, CARRIER, b.typeId),
    );
    if (fort === undefined) throw new Error('no defence-capable store in the sandbox content');
    const world = snapshotOf([
      settler(1, CARRIER, { JobAssignment: { workplace: TOWER } }),
      building(fort.typeId),
    ]);
    expect(rangeRingsOf(content, world, [TOWER])).toEqual([
      expect.objectContaining({ entity: TOWER, kind: 'defence' }),
    ]);
  });

  it("draws no pickup area for a workshop's carrier", () => {
    const world = snapshotOf([
      settler(1, CARRIER, { JobAssignment: { workplace: TOWER } }),
      building(workshop.typeId),
    ]);
    expect(rangeRingsOf(content, world, [1, TOWER])).toEqual([]);
  });

  it('costs the ids, not the map', () => {
    const crowd = snapshotOf([
      ...Array.from({ length: 4096 }, (_unused, i) => settler(i + 1, COLLECTOR)),
      settler(5000, HUNTER, { JobAssignment: { workplace: LODGE } }),
    ]);
    const counted = visitCountingSnapshot(crowd);
    expect(rangeRingsOf(content, counted.snapshot, [5000])).toHaveLength(1);
    expect(counted.visits()).toBeLessThanOrEqual(idLookupVisits(1, crowd.entities.length));
  });
});

describe('createWorkAreaOverlay', () => {
  it('keeps the shown settlers, hides them on a second toggle and bumps its version on each', () => {
    const overlay = createWorkAreaOverlay();
    overlay.toggle([1, 2]);
    expect([...overlay.ids()]).toEqual([1, 2]);
    const shown = overlay.version();

    overlay.toggle([1, 2]);
    expect(overlay.ids().size).toBe(0);
    expect(overlay.version()).toBeGreaterThan(shown);
  });

  it('shows a mixed group whole rather than flipping each member', () => {
    const overlay = createWorkAreaOverlay();
    overlay.toggle([1]);
    overlay.toggle([1, 2]);
    expect([...overlay.ids()]).toEqual([1, 2]);
  });
});
