// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOffers } from '../../../../src/hud/dom/diplomacy-window/details.js';
import type { DiplomacyOffer } from '../../../../src/hud/dom/diplomacy-window/model.js';

afterEach(() => document.body.replaceChildren());

const OFFER: DiplomacyOffer = {
  index: 0,
  give: { goodType: 8, label: 'Coins', amount: 5 },
  take: { goodType: 3, label: 'Wood', amount: 10 },
};

function mount() {
  const onBefriend = vi.fn();
  const view = createOffers(() => undefined, onBefriend);
  document.body.append(view.element);
  const find = <T extends HTMLElement>(selector: string) => view.element.querySelector<T>(selector);
  return {
    view,
    onBefriend,
    lock: () => find('.on-dip-trade-lock'),
    list: () => find('.on-dip-offer-list'),
    hint: () => find('.on-dip-trade-lock__hint'),
    befriend: () => find<HTMLButtonElement>('.on-dip-trade-lock button'),
  };
}

describe('diplomacy trade offers lock', () => {
  it('greys the offers and offers the friendly declaration while your stance shuts trade', () => {
    const { view, onBefriend, lock, list, hint, befriend } = mount();

    view.update([OFFER], { yours: 'neutral', theirs: 'friend', canBefriend: true, befriending: false });
    expect(lock()?.hidden).toBe(false);
    expect(list()?.classList.contains('on-dip-offer-list--locked')).toBe(true);
    expect(hint()?.hidden).toBe(true);
    befriend()?.click();
    expect(onBefriend).toHaveBeenCalledOnce();

    view.update([OFFER], null);
    expect(lock()?.hidden).toBe(true);
    expect(list()?.classList.contains('on-dip-offer-list--locked')).toBe(false);
  });

  it('keeps the offers grey with no button while only their stance shuts trade', () => {
    const { view, lock, hint, befriend } = mount();

    view.update([OFFER], { yours: 'friend', theirs: 'enemy', canBefriend: true, befriending: false });
    expect(lock()?.hidden).toBe(false);
    expect(befriend()?.hidden).toBe(true);
    expect(hint()?.hidden).toBe(false);
  });
});
