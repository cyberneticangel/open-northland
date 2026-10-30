# Open the map-placed doors on unwalkable ground

**Area:** sim, data · **Priority:** P2

Two buildings the decoded maps place have their door on unwalkable ground, so their workers can never
enter or leave. `packages/app/test/real-content/maps/door-exits.test.ts` floods from every map-placed
door and pins them in `KNOWN_SEALED_DOORS`: `niezwykla_wyprawa` `work_brewery` door (39,24) and
`wielka_inwazja` `work_well_00` door (325,189).

## Scope

- Investigate first: compare each building's extracted footprint cells, door and anchor, and the ground
  under the door, with the owned copy's data. A door on unwalkable ground suggests an anchor join or a
  ground decode that differs from the original's.
- Fix the data or join where it differs.
- Keep a door listed only with byte-level evidence that the original seals it too, named in the list.

## Verify

`door-exits.test.ts` with the fixed doors removed from `KNOWN_SEALED_DOORS`; the sim footprint suites;
the content tests of the affected maps.
