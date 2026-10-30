# Extract the remaining per-job flags from jobtypes.ini

**Area:** pipeline · **Priority:** P3

`packages/formats/src/ini/types/jobs.ts` extracts `needsReligionFlag`, `ignoresHomeHouseFlag`,
`userCanChangeProductionFlag` and `mustHaveWorkHouseFlag`. `Data/logic/jobtypes.ini` also carries
flags that nothing reads (line counts over the 55 `[jobtype]` sections): `canBeTrainedFlag` 55,
`canHaveWorkHouseFlag` 41, `mustHaveFinishedWorkHouseFlag` 39, `UserShouldAttachWorkPlaceAfterJobChangeFlag` 17.

Two consumers already approximate what these state outright:

- The semantic job-capability bindings tracked in
  [job-semantic-capabilities](../app/job-semantic-capabilities.md) read soldier/hero/scout/hunter roles
  from id slugs. `ignoresHomeHouseFlag 1` covers exactly {25 trader, 27 scout, 31..47} but neither splits
  soldier from hero nor isolates the hunter, so it is source data, not a replacement role field.
- `mustHaveFinishedWorkHouseFlag` is cited in prose and hardcoded as a blanket in three seams:
  `settlers/targets/workplaces.ts` `boundWorkplaceTarget`, `settlers/drives/farming/drive.ts`, and
  `settlers/drives/economy/site-staff.ts` `planSiteStaff`. Verified against the owned copy, the flag is 0
  for the hunter and the scout, and `ir.json` gives the headquarters and every warehouse tier
  a hunter slot (`count 3`) that the app deliberately posts a gatherer into. So a hunter posted to a store
  stops hunting for the whole of that store's upgrade, where the data says he should carry on.

## Scope

- Extract `mustHaveFinishedWorkHouseFlag` onto `JobType` and regenerate; confirm its per-job values
  against the owned copy first (keys are case-sensitive and not every section carries every key).
- Replace the hardcoded finished-workhouse gate in the three seams above with the extracted flag, and
  record whether the real values change its behaviour. Cover the hunter case: a hunter posted to a
  warehouse keeps harvesting while that warehouse is upgraded, while a baker still stands down.
- Extract the other flags only with a consumer that reads them, kept separate from the authored
  semantic capabilities.

## Verify

`npm run test:pipeline` against the selected data pack, plus a unit test pinning the extracted flag of a job
that sets it. `npm test`, `npm run check`, `npm run build`.
