import type { PlayerFlag } from '@open-northland/net-protocol';
import { bcp47Tag, compareLabels } from '../../../../i18n/index.js';
import { node } from '../../dom.js';

// The flag-icons package (MIT); each image is its own file, fetched when a flag is first shown.
const images = import.meta.glob<string>(
  '../../../../../../../node_modules/flag-icons/flags/4x3/[a-z][a-z].svg',
  {
    query: '?no-inline',
    import: 'default',
    eager: true,
  },
);

const TWO_LETTER_FILE = /\/([a-z]{2})\.svg$/;
// Only regions Unicode names: the set's placeholder `xx` and organisations such as `pc` have no name.
const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

const urls = new Map<string, string>();
for (const [path, url] of Object.entries(images)) {
  const code = TWO_LETTER_FILE.exec(path)?.[1]?.toUpperCase();
  if (code !== undefined && regions.of(code) !== undefined) urls.set(code, url);
}

export function flagUrl(code: string): string | undefined {
  return urls.get(code);
}

export function hasFlag(code: string): boolean {
  return urls.has(code);
}

const names = new Map<string, Intl.DisplayNames>();

/** The region's name in the player's language, or the code where the language names none. */
export function flagName(code: string, tag: string = bcp47Tag()): string {
  let display = names.get(tag);
  if (display === undefined) {
    display = new Intl.DisplayNames([tag], { type: 'region', fallback: 'code' });
    names.set(tag, display);
  }
  return display.of(code) ?? code;
}

/** Every flag the set draws, by name in the player's language. */
export function flagCodes(tag: string = bcp47Tag()): readonly string[] {
  const compare = compareLabels(tag);
  return [...urls.keys()].sort((a, b) => compare(flagName(a, tag), flagName(b, tag)));
}

/** The flag shown before a nick; nothing for no flag or one this build cannot draw. */
export function flagBadge(flag: PlayerFlag | undefined): HTMLImageElement | null {
  const url = flag === undefined ? undefined : urls.get(flag);
  if (flag === undefined || url === undefined) return null;
  const image = node('img', 'network-flag');
  image.src = url;
  image.alt = flagName(flag);
  image.title = image.alt;
  image.decoding = 'async';
  return image;
}

/** A nick led by its flag, when it has one this build draws. */
export function nickWithFlag<K extends 'span' | 'strong'>(
  tag: K,
  className: string,
  nick: string,
  flag: PlayerFlag | undefined,
): HTMLElementTagNameMap[K] {
  const element = node(tag, className);
  const badge = flagBadge(flag);
  if (badge !== null) element.append(badge);
  element.append(nick);
  return element;
}
