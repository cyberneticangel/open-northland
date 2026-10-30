import { components } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_JOINER } from '../../catalog/jobs.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const WIDTH = 26;
const HEIGHT = 20;
const SCHOOL_AT = { x: 12, y: 7 } as const;
const PUPILS_ROW_Y = 15;
const FIRST_PUPIL_X = 6;
const PUPIL_SPACING = 2;
/** Two more than the school's five seats, so two wait in the yard for the first class to finish. */
const PUPILS = 7;
/** Long enough for the walk, two courses back to back and the queue's next idle beat. */
const RUN_TICKS = 900;

/**
 * Seven collectors are sent at once to learn carpentry at a five-seat school: five take the seats, two
 * wait in the yard and start when the first class leaves.
 */
export const schoolQueueScene: SceneDefinition = {
  id: 'school-queue',
  seed: 65,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    const school = placeBuiltSandboxBuilding(sim, 'school', SCHOOL_AT.x, SCHOOL_AT.y);
    // The queue is this scene's subject; technology discovery has its own scene.
    sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
    for (let i = 0; i < PUPILS; i++) {
      const pupil = spawnSettlerDirect(sim, JOB_COLLECTOR, FIRST_PUPIL_X + i * PUPIL_SPACING, PUPILS_ROW_Y);
      sim.enqueueSetup({ kind: 'learn', entity: pupil, house: school, target: 'job', typeId: JOB_JOINER });
    }
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'every pupil, the queued two included, leaves a joiner',
      predicate: (sim) => {
        const joiners = [...sim.world.query(components.Settler)].filter(
          (e) => sim.world.get(e, components.Settler).jobType === JOB_JOINER,
        );
        return joiners.length === PUPILS && !joiners.some((e) => sim.world.has(e, components.TrainingOrder));
      },
    },
  ],
};
