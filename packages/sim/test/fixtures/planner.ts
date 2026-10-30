import { Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import type { Simulation } from '../../src/simulation.js';
import { plannerContextOf } from '../../src/systems/settlers/drives/ladder.js';
import type { PlannerContext } from '../../src/systems/settlers/planner/context.js';
import { beginPlannerPass, type PlannerPass } from '../../src/systems/settlers/planner/pass.js';
import { ctxOf } from './context.js';

/** A fresh planner pass and the context the ladder would hand adult `e` standing on `here`, unconfined. */
export function plannerContextAt(
  sim: Simulation,
  e: Entity,
  here: NodeId,
): { readonly pass: PlannerPass; readonly plan: PlannerContext } {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const settler = sim.world.get(e, Settler);
  if (settler.jobType === null) throw new Error('settler without a trade');
  const pass = beginPlannerPass(sim.world, ctxOf(sim), terrain);
  return { pass, plan: plannerContextOf(pass, e, settler, settler.jobType, here, null) };
}
