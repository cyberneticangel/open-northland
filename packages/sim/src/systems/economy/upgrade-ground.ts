import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import { removePalisadesOn } from '../palisades/index.js';
import { clearRoadsOn } from '../roads/sites.js';

/**
 * Clear the body `building`'s `targetType` tier stands on: every wall, wall site, road and road site there
 * goes, and nothing they hold comes back. Runs as an upgrade starts, and again as it adopts its tier for
 * what was ordered over the reserve meanwhile. Owner ruling.
 */
export function clearUpgradeGround(
  world: World,
  ctx: SystemContext,
  building: Entity,
  targetType: number,
): void {
  const terrain = ctx.terrain;
  const pos = world.tryGet(building, Position);
  const house = world.tryGet(building, Building);
  if (terrain === undefined || pos === undefined || house === undefined) return;
  const footprint = buildingFootprintOf(ctx.content, targetType, house.tribe, house.record);
  if (footprint === undefined) return;
  const { hx, hy } = nodeOfPosition(pos.x, pos.y);
  const body = new Set(translatedCells(terrain, footprint.blocked, hx, hy));
  removePalisadesOn(world, ctx, terrain, body);
  clearRoadsOn(world, terrain, body);
}
