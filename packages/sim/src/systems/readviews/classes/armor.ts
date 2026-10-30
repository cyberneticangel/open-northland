import type { ArmorType } from '@open-northland/data';

/** The `armortypes.ini` `maintype` class ids. */
export const ARMOR_MAIN_TYPE = {
  LIGHT: 1,
  HEAVY: 2,
} as const;

/**
 * The extracted `materialType`: `1` cloth, `2` leather, `3` chain, `4` plate. Finer than
 * the `maintype` class, which collapses the four base records into two.
 */
export function armorMaterialOf(armor: ArmorType): number | undefined {
  return armor.materialType;
}
