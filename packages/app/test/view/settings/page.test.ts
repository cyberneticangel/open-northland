// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSettingsPage, initialSettingsMemory } from '../../../src/view/settings/page.js';
import { defaultSettings } from '../../../src/view/settings/store.js';

afterEach(() => document.body.replaceChildren());

/** The audio tab of a settings page, opened from a game or from the main menu. */
function audioTab(inGame: boolean): void {
  const page = createSettingsPage({
    settings: {
      current: defaultSettings,
      update: async () => true,
      pinnedUiScale: null,
      effectiveUiScaleFor: (factor) => factor,
      ...(inGame ? { inGame: true } : {}),
    },
    memory: { ...initialSettingsMemory(), tab: 'audio' },
    signal: new AbortController().signal,
  });
  document.body.append(page.el);
  page.render();
}

describe('the music source choice', () => {
  it('shows in a game and not in the main menu', () => {
    audioTab(false);
    expect(document.querySelector('[data-settings-focus^="music-source"]')).toBeNull();
    document.body.replaceChildren();
    audioTab(true);
    expect(document.querySelector('[data-settings-focus^="music-source"]')).not.toBeNull();
  });
});
