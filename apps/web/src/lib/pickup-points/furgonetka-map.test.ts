import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FURGONETKA_MAP_SCRIPT,
  loadFurgonetkaMap,
  MapLoadError,
  resetFurgonetkaMapForTests,
} from './furgonetka-map';

// happy-dom pobrałby skrypt z sieci: przechwytujemy dodanie skryptu do <head>.
let appended: HTMLScriptElement[] = [];

beforeEach(() => {
  appended = [];
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    for (const node of nodes) {
      if (node instanceof HTMLScriptElement) {
        appended.push(node);
        // Usunięcie skryptu (po błędzie) wycofuje go z listy.
        node.remove = () => {
          appended = appended.filter((script) => script !== node);
        };
      }
    }
  });
});

const scripts = () => appended.filter((script) => script.src === FURGONETKA_MAP_SCRIPT);

afterEach(() => {
  resetFurgonetkaMapForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadFurgonetkaMap', () => {
  it('jeden skrypt na stronę, także przy równoczesnych kliknięciach', async () => {
    const first = loadFurgonetkaMap();
    const second = loadFurgonetkaMap();
    expect(scripts()).toHaveLength(1);
    const Map = vi.fn();
    window.Furgonetka = { Map };
    scripts()[0]?.dispatchEvent(new Event('load'));
    expect(await first).toBe(window.Furgonetka);
    expect(await second).toBe(window.Furgonetka);
    expect(await loadFurgonetkaMap()).toBe(window.Furgonetka);
    expect(scripts()).toHaveLength(1);
  });

  it('błąd skryptu i przekroczony czas: MapLoadError, a następna próba wczytuje od nowa', async () => {
    const failed = loadFurgonetkaMap();
    scripts()[0]?.dispatchEvent(new Event('error'));
    await expect(failed).rejects.toEqual(new MapLoadError('load'));
    expect(scripts()).toHaveLength(0);

    vi.useFakeTimers();
    const slow = loadFurgonetkaMap(1_000);
    vi.advanceTimersByTime(1_000);
    await expect(slow).rejects.toMatchObject({ reason: 'timeout' });
    expect(scripts()).toHaveLength(0);

    void loadFurgonetkaMap();
    expect(scripts()).toHaveLength(1);
  });
});
