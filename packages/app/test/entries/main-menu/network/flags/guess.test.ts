import { expect, it } from 'vitest';
import { guessFlag } from '../../../../../src/entries/main-menu/network/flags/guess.js';

const DRAWN = new Set(['PL', 'CN', 'US', 'DE']);
const known = (code: string): boolean => DRAWN.has(code);

it('takes the region a language names, or the one it implies, from the first language that has one', () => {
  expect(guessFlag(['pl-PL', 'en-US'], known)).toBe('PL');
  expect(guessFlag(['zh'], known)).toBe('CN');
  expect(guessFlag(['zh-Hans'], known)).toBe('CN');
  expect(guessFlag(['en'], known)).toBe('US');
  expect(guessFlag(['de-AT', 'de'], known)).toBe('DE');
});

it('guesses no flag when no language names a drawn region', () => {
  expect(guessFlag([], known)).toBeUndefined();
  expect(guessFlag(['not a tag!', 'fr-FR'], known)).toBeUndefined();
});
