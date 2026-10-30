import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildingFootprintFor, footprintCellDx } from '@open-northland/data';
import { components, dynamicBlockOverlay, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr } from '../helpers.js';
import { realMapWorld } from '../real-map-world.js';

const { Building, Position } = components;

/** Nodes a door's flood must reach to count as open, more than any pocket between authored bodies. */
const OPEN_FLOOD_NODES = 60;

/**
 * The map-placed doors the walk block seals: every edge out lands on another building's body or a
 * resource, or the door node is unwalkable. Each is open work in
 * `docs/tickets/sim/map-placed-doors-sealed.md`; the list keeps any new one out.
 */
const KNOWN_SEALED_DOORS = [
  'niezwykla_wyprawa work_brewery tribe 1 door 39,24',
  'wielka_inwazja work_well_00 tribe 4 door 325,189',
];

/** Every placed building whose door floods fewer than {@link OPEN_FLOOD_NODES} nodes under the walk
 *  block, named by map, type, tribe and door node. */
function sealedDoors(sim: Simulation, mapId: string): string[] {
  const terrain = sim.terrain;
  if (terrain === undefined) return [];
  const blocked = dynamicBlockOverlay(sim.world, { content: sim.content }, terrain);
  const sealed: string[] = [];
  for (const e of sim.world.query(Building, Position)) {
    const building = sim.world.get(e, Building);
    const type = sim.content.buildings.find((row) => row.typeId === building.buildingType);
    const footprint =
      type === undefined ? undefined : buildingFootprintFor(type, building.tribe, building.record);
    if (type === undefined || footprint?.door === undefined || footprint.blocked.length === 0) continue;
    const p = sim.world.get(e, Position);
    const anchor = nodeOfPosition(p.x, p.y);
    const x = anchor.hx + footprintCellDx(anchor.hy, footprint.door);
    const y = anchor.hy + footprint.door.dy;
    if (!terrain.inBounds(x, y)) continue;
    const door = terrain.nodeAt(x, y);
    const seen = new Set([door]);
    const queue = [door];
    for (let at = 0; at < queue.length && seen.size < OPEN_FLOOD_NODES; at++) {
      for (const { node } of terrain.steps(queue[at] ?? door, blocked)) {
        if (seen.has(node)) continue;
        seen.add(node);
        queue.push(node);
      }
    }
    if (seen.size < OPEN_FLOOD_NODES)
      sealed.push(`${mapId} ${type.id} tribe ${building.tribe} door ${x},${y}`);
  }
  return sealed;
}

describe.runIf(hasRealIr())('map-placed doors', () => {
  it('leave by a lattice edge on every decoded map, the known sealed ones aside', {
    timeout: 900_000,
  }, async () => {
    const maps = JSON.parse(readFileSync(resolve(contentDir(), 'maps-index.json'), 'utf8')) as {
      id: string;
    }[];
    const sealed: string[] = [];
    for (const { id } of maps) {
      const { sim } = await realMapWorld({ mapId: id, machineSeats: [], missions: false, berryBushes: true });
      sealed.push(...sealedDoors(sim, id));
    }
    expect(sealed.sort()).toEqual([...KNOWN_SEALED_DOORS].sort());
  });
});
