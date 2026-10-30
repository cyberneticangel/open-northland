/** The first region the player's languages name, or imply (`pl` is Poland's, `zh` China's), among
 *  those `known` holds; none when none does. */
export function guessFlag(
  languages: readonly string[],
  known: (code: string) => boolean,
): string | undefined {
  for (const tag of languages) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(tag);
    } catch {
      continue;
    }
    const region = locale.region ?? locale.maximize().region;
    if (region !== undefined && known(region)) return region;
  }
  return undefined;
}
