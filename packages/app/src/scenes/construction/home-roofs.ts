import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../../catalog/buildings.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HOME_00,
  BUILDING_HOME_01,
  BUILDING_HOME_02,
  BUILDING_HOME_03,
  BUILDING_HOME_04,
  placeBuiltSandboxBuilding,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 40;
const MAP_H = 24;
/** Five homes a row, an odd count, so a column's two homes take consecutive ids in different skin slots. */
const LEVELS = [BUILDING_HOME_00, BUILDING_HOME_01, BUILDING_HOME_02, BUILDING_HOME_03, BUILDING_HOME_04];
const COLUMN_STEP = 7;
const ROWS = [7, 16] as const;
const FIRST_COLUMN = 5;

function build(sim: Simulation): void {
  for (const y of ROWS) {
    for (const [column, type] of LEVELS.entries()) {
      placeBuiltSandboxBuilding(sim, type, FIRST_COLUMN + column * COLUMN_STEP, y, HUMAN_PLAYER, {
        tribe: VIKING,
      });
    }
  }
}

/** Every viking home level twice, so both roof palettes show on levels 4 and 5. */
export const homeRoofsScene: SceneDefinition = {
  id: 'home-roofs',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: [VIKING],
  initialZoom: 0.6,
  runTicks: 1,
  checks: [
    {
      label: 'two viking homes stand at each level',
      predicate: (sim) => [...sim.world.query(components.Building)].length === ROWS.length * LEVELS.length,
    },
  ],
};
