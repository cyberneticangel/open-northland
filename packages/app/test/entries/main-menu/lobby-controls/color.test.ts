// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { colorPalette } from '../../../../src/entries/main-menu/lobby-controls/color.js';

const RED = 1;
const BROWN = 19;
const SEAT_THREE = 2;

const palette = (value: number) =>
  colorPalette(
    { label: 'Colour', name: String, taken: (seat) => `seat ${seat + 1}`, change: () => {} },
    { value, disabled: false, wearer: (color) => (color === RED ? SEAT_THREE : undefined) },
    0,
  );
const swatch = (strip: HTMLElement, color: number): HTMLButtonElement => {
  const found = strip.querySelector<HTMLButtonElement>(`[data-focus="swatch:0:${color}"]`);
  if (found === null) throw new Error(`no swatch ${color}`);
  return found;
};

it("marks a colour another seat wears with that seat's number and leaves the rest free", () => {
  const strip = palette(BROWN);
  const red = swatch(strip, RED);
  expect(red.disabled).toBe(true);
  expect(red.textContent).toBe('3');
  expect(red.title).toBe('Colour: 1 (seat 3)');
  expect(swatch(strip, BROWN).disabled).toBe(false);
  expect(swatch(strip, BROWN).textContent).toBe('');
});

it('never marks the seat’s own colour as taken', () => {
  const red = swatch(palette(RED), RED);
  expect(red.disabled).toBe(false);
  expect(red.classList.contains('is-taken')).toBe(false);
});

it('locks the whole strip while the palette is disabled', () => {
  const strip = colorPalette(
    { label: 'Colour', name: String, taken: (seat) => `seat ${seat + 1}`, change: () => {} },
    { value: BROWN, disabled: true },
    0,
  );
  expect(strip.classList.contains('is-locked')).toBe(true);
  expect(swatch(strip, BROWN).disabled).toBe(true);
});
