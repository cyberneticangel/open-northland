import type { PlayerFlag } from '@open-northland/net-protocol';
import { type DropdownChoice, dropdownControl } from '../../../../hud/dom/parts/dropdown.js';
import { messages } from '../../../../i18n/index.js';
import { storedFlag } from '../../../relay/identity.js';
import { flagCodes, flagName, flagUrl, hasFlag } from './catalog.js';
import { guessFlag } from './guess.js';

/** The dropdown's id for no flag; flag codes are two capital letters. */
const NONE = 'none';
/** What the narrow button shows for no flag, where a flag would be. */
const NO_FLAG_FACE = '-';

/** The flag field of the connection form: the stored choice, or a guess from the browser's languages
 *  until the player makes one. */
export function flagPicker(languages: readonly string[] = navigator.languages) {
  const copy = messages().network;
  const stored = storedFlag();
  // A stored choice of none stays none; an unmade choice, or a flag this build cannot draw, is guessed.
  let value: PlayerFlag | undefined =
    stored === null
      ? undefined
      : stored !== undefined && hasFlag(stored)
        ? stored
        : guessFlag(languages, hasFlag);
  const choices: DropdownChoice<string>[] = [
    { id: NONE, label: copy.noFlag, short: NO_FLAG_FACE },
    ...flagCodes().flatMap((code) => {
      const image = flagUrl(code);
      return image === undefined ? [] : [{ id: code, label: flagName(code), image }];
    }),
  ];
  const dropdown = dropdownControl({
    label: copy.flag,
    className: 'main-menu__dropdown',
    entries: choices,
    active: value ?? NONE,
    onPick: (id) => {
      value = id === NONE ? undefined : id;
      dropdown.setActive(id);
      describe();
    },
  });
  // The button shows the flag alone; its name is the tooltip.
  const describe = (): void => {
    dropdown.button.title = value === undefined ? copy.noFlag : flagName(value);
  };
  describe();
  dropdown.root.classList.add('network-menu__flag');
  return {
    element: dropdown.root,
    value: (): PlayerFlag | undefined => value,
    setDisabled: dropdown.setDisabled,
  };
}
