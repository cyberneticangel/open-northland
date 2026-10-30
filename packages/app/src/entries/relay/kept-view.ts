import { type SavedView, savedViewOf } from '../../view/runtime/save-load/view-state.js';

const KEY_PREFIX = 'open-northland.relay-view:';
const MEMORY_KEY_PREFIX = 'open-northland.relay-memory:';

/**
 * The control groups and the fog memory a relayed game keeps across a rebuilt world: a relay snapshot
 * carries no view of this client's, so a resync would wipe them, and a reload of this tab reads them
 * back from session storage. Keyed by relay and room; storage denial keeps them for this document only.
 */
export interface KeptView {
  get(): SavedView | null;
  /** `view` null forgets them and the memory, as leaving the game does. */
  set(view: SavedView | null): void;
  /** The presentation memory, as a save keeps it. */
  memory(): string | null;
  setMemory(memory: string | null): void;
}

export function keptView(relayUrl: string, roomId: string): KeptView {
  const key = `${KEY_PREFIX}${relayUrl}#${roomId}`;
  const memoryKey = `${MEMORY_KEY_PREFIX}${relayUrl}#${roomId}`;
  let current = stored(key);
  let memory = storedText(memoryKey);
  const setMemory = (text: string | null): void => {
    memory = text;
    try {
      if (text === null) window.sessionStorage.removeItem(memoryKey);
      else window.sessionStorage.setItem(memoryKey, text);
    } catch {
      // Unavailable or full storage leaves the memory to this document; an older copy must not outlive it.
      try {
        window.sessionStorage.removeItem(memoryKey);
      } catch {
        // Unavailable storage holds no older copy either.
      }
    }
  };
  return {
    get: () => current,
    set(view): void {
      current = view;
      try {
        if (view === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify(view));
      } catch {
        // Unavailable storage leaves the groups to this document.
      }
      if (view === null) setMemory(null);
    },
    memory: () => memory,
    setMemory,
  };
}

function storedText(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function stored(key: string): SavedView | null {
  try {
    const text = window.sessionStorage.getItem(key);
    return text === null ? null : savedViewOf(JSON.parse(text));
  } catch {
    return null;
  }
}
