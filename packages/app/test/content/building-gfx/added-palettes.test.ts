import { describe, expect, it } from 'vitest';
import { withAddedHousePalettes } from '../../../src/content/building-gfx/added-palettes.js';
import type { BuildingBobRow, ConstructionLayerRow } from '../../../src/content/ir/rows.js';

const VIKING = 1;
const HOME_LEVEL_3 = 4;
const HOME_LEVEL_4 = 5;
const FARM = 12;
const BMD = 'data/engine2d/bin/bobs/ls_houses_viking.bmd';

function body(typeId: number, editName: string, paletteName = 'house01'): BuildingBobRow {
  return { tribeId: VIKING, typeId, level: 0, bmd: BMD, paletteName, bobId: 21, editName };
}

const stage: ConstructionLayerRow = {
  tribeId: VIKING,
  typeId: HOME_LEVEL_4,
  level: 2,
  upgrade: false,
  stackIdx: 0,
  bmd: BMD,
  paletteName: 'house01',
  bobId: 23,
  fromPct: 10,
  toPct: 70,
  editName: 'viking home',
};

describe('withAddedHousePalettes', () => {
  it("gives a level 4 viking home's body and construction stages a house02 twin after its own rows", () => {
    const home = body(HOME_LEVEL_4, 'viking home');
    const ir = withAddedHousePalettes({ buildingBobs: [home], constructionLayers: [stage] });
    expect(ir.buildingBobs).toEqual([home, { ...home, paletteName: 'house02' }]);
    expect(ir.constructionLayers).toEqual([stage, { ...stage, paletteName: 'house02' }]);
  });

  it('leaves other types alone and never repeats a palette the type already lists', () => {
    const farm = [body(FARM, 'viking farm'), body(FARM, 'viking farm', 'house02')];
    const level3 = body(HOME_LEVEL_3, 'viking home');
    const home = [body(HOME_LEVEL_4, 'viking home'), body(HOME_LEVEL_4, 'viking home', 'house02')];
    expect(withAddedHousePalettes({ buildingBobs: [...farm, level3, ...home] }).buildingBobs).toEqual([
      ...farm,
      level3,
      ...home,
    ]);
  });
});
