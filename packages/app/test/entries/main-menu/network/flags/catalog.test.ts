// @vitest-environment jsdom
import { expect, it } from 'vitest';
import {
  flagBadge,
  flagCodes,
  nickWithFlag,
} from '../../../../../src/entries/main-menu/network/flags/catalog.js';

it('draws the flag set’s two-letter flags of named regions, without its placeholder', () => {
  const codes = flagCodes('en');
  expect(codes).toContain('PL');
  expect(codes).toContain('CN');
  expect(codes).not.toContain('XX');
  expect(codes).not.toContain('PC');
  expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
});

it('leads a nick with its flag, and with nothing for no flag or one this build cannot draw', () => {
  const named = nickWithFlag('span', '', 'Ania', 'PL');
  expect(named.querySelector('img')?.getAttribute('src')).toMatch(/pl\.svg/);
  expect(named.textContent).toBe('Ania');
  expect(flagBadge(undefined)).toBeNull();
  expect(flagBadge('QQ')).toBeNull();
});
