import { halfCellToScreen, type SeenRoadNetwork, terrainWorldBounds } from '@open-northland/render';
import { cellOfNode, FOG_MODE, FOG_STATE, type FogView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createRoadRaster, fogCellXOfNode, ROAD_DOT_COLOUR } from '../../../src/hud/minimap/road-layer.js';
import { type DotRaster, stampMark } from '../../../src/hud/minimap/stamps.js';

const MAP_CELLS = 8;
const NODE_WIDTH = 2 * MAP_CELLS;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const SCALE = 0.5;
const STAMP_SCALE = 1;
const VIEWER = 0;
const OTHER_SEAT = 1;
const GEOMETRY = { bounds: BOUNDS, scale: SCALE, nodeWidth: NODE_WIDTH };

const node = (hx: number, hy: number): number => hy * NODE_WIDTH + hx;
const NEAR = node(4, 4);
const FAR = node(12, 12);

function blankRaster(): DotRaster {
  const width = Math.ceil(BOUNDS.width * SCALE);
  const height = Math.ceil(BOUNDS.height * SCALE);
  return { rgba: new Uint8Array(width * height * 4), width, height };
}

/** The raster the stamps alone draw for `nodes`, the reference a bake must equal. */
function stamped(nodes: readonly number[], stampScale = STAMP_SCALE): Uint8Array {
  const raster = blankRaster();
  for (const id of nodes) {
    const at = halfCellToScreen(id % NODE_WIDTH, Math.floor(id / NODE_WIDTH));
    const x = (at.x - BOUNDS.minX) * SCALE;
    const y = (at.y - BOUNDS.minY) * SCALE;
    stampMark(raster, x, y, 'road', ROAD_DOT_COLOUR, stampScale);
  }
  return raster.rgba;
}

/** Byte equality: a deep `toEqual` over the RGBA array costs more than the bake it checks. */
function expectSameRaster(actual: Uint8Array, expected: Uint8Array): void {
  expect(Buffer.compare(actual, expected)).toBe(0);
}

/** A seen road network whose node reads are counted. */
function network(nodes: readonly number[], revision: number): { view: SeenRoadNetwork; reads: () => number } {
  let reads = 0;
  const set = new Set(nodes);
  return {
    view: {
      revision,
      get nodes() {
        reads++;
        return set;
      },
    },
    reads: () => reads,
  };
}

function fogOf(explored: (cellX: number) => boolean, generation: number, player = VIEWER): FogView {
  return {
    player,
    mode: FOG_MODE.CLASSIC_FOG_OF_WAR,
    cellsWide: MAP_CELLS,
    cellsHigh: MAP_CELLS,
    generation,
    stateAt: (cellX) => (explored(cellX) ? FOG_STATE.EXPLORED : FOG_STATE.UNEXPLORED),
  };
}

describe('minimap road raster', () => {
  it('stamps every laid node at its half-cell spot', () => {
    const raster = blankRaster();
    const draw = createRoadRaster(raster, GEOMETRY);
    expect(draw(network([NEAR, FAR], 1).view, null, STAMP_SCALE)).toBe(true);
    expectSameRaster(raster.rgba, stamped([NEAR, FAR]));
  });

  it('leaves the road nodes alone on a replot of unchanged roads, and re-reads them on a new revision', () => {
    const raster = blankRaster();
    const draw = createRoadRaster(raster, GEOMETRY);
    const roads = network([NEAR, FAR], 1);
    draw(roads.view, null, STAMP_SCALE);
    const readsAfterBake = roads.reads();
    expect(draw(roads.view, null, STAMP_SCALE)).toBe(false);
    expect(roads.reads()).toBe(readsAfterBake);

    const longer = network([NEAR, FAR, node(6, 4)], 2);
    expect(draw(longer.view, null, STAMP_SCALE)).toBe(true);
    expect(longer.reads()).toBeGreaterThan(0);
    expectSameRaster(raster.rgba, stamped([NEAR, FAR, node(6, 4)]));
  });

  it('hides roads on unexplored ground and adds them as the ground is explored, without the network', () => {
    const raster = blankRaster();
    const draw = createRoadRaster(raster, GEOMETRY);
    const roads = network([NEAR, FAR], 1);
    expect(
      draw(
        roads.view,
        fogOf((cellX) => cellX < 4, 1),
        STAMP_SCALE,
      ),
    ).toBe(true);
    expectSameRaster(raster.rgba, stamped([NEAR]));
    const readsAfterBake = roads.reads();

    // A sighting elsewhere bumps the generation but explores nothing new: the raster keeps.
    expect(
      draw(
        roads.view,
        fogOf((cellX) => cellX < 4, 2),
        STAMP_SCALE,
      ),
    ).toBe(false);
    expect(
      draw(
        roads.view,
        fogOf(() => true, 3),
        STAMP_SCALE,
      ),
    ).toBe(true);
    expectSameRaster(raster.rgba, stamped([NEAR, FAR]));
    expect(roads.reads()).toBe(readsAfterBake);
  });

  it('redraws whole for another seat and for another stamp size', () => {
    const raster = blankRaster();
    const draw = createRoadRaster(raster, GEOMETRY);
    const world = network([NEAR, FAR], 1).view;
    draw(
      world,
      fogOf(() => true, 1),
      STAMP_SCALE,
    );
    // The other seat has explored less under the same generation: its own fog, from scratch.
    const otherSeat = fogOf((cellX) => cellX < 4, 1, OTHER_SEAT);
    expect(draw(world, otherSeat, STAMP_SCALE)).toBe(true);
    expectSameRaster(raster.rgba, stamped([NEAR]));
    const zoomedStamp = STAMP_SCALE / 2;
    expect(draw(world, null, zoomedStamp)).toBe(true);
    expectSameRaster(raster.rgba, stamped([NEAR, FAR], zoomedStamp));
  });

  it("finds a node's fog cell by the sim's own node-to-cell rule", () => {
    for (let hy = 0; hy < 2 * MAP_CELLS; hy++) {
      for (let hx = 0; hx < NODE_WIDTH; hx++) expect(fogCellXOfNode(hx, hy)).toBe(cellOfNode(hx, hy).cx);
    }
  });
});
