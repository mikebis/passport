import { describe, expect, it } from 'vitest';
import { ThemePreference, THEME_STORAGE_KEY, type ThemeStorage } from '../src/theme';
import { findTheme, THEMES } from '../src/themes';
import paperGrain from '../src/themes/medieval/paper-grain.svg?raw';

function storage(saved?: string): ThemeStorage & { values: Map<string, string>; writes: string[] } {
  const values = new Map(saved === undefined ? [] : [[THEME_STORAGE_KEY, saved]]);
  const writes: string[] = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
}

describe('theme packages', () => {
  it('provides original dragon/galleon models and a small static paper texture', () => {
    const medieval = findTheme('medieval')!;
    expect(medieval.sceneryDescription).toContain('dragons');
    expect(medieval.artwork).toContain('data-model="galleon"');
    expect(medieval.artwork).toContain('data-model="dragon"');
    expect(paperGrain.length).toBeLessThan(4096);
    expect(paperGrain).not.toMatch(/<(filter|script|image|animate)\b/);
  });

  it('has unique registered IDs, Classic as default, and complete local artwork', () => {
    expect(THEMES.map(theme => theme.id)).toEqual(['classic', 'dark', 'medieval']);
    expect(new Set(THEMES.map(theme => theme.id)).size).toBe(THEMES.length);
    expect(findTheme('missing')).toBeUndefined();
    expect(THEMES[0].artwork).toBe(THEMES[1].artwork);
    expect(THEMES[2].artwork).not.toBe(THEMES[0].artwork);
    for (const theme of THEMES) {
      for (const kind of ['ship', 'plane', 'cloud']) expect(theme.artwork).toContain(`id="${kind}"`);
      expect(theme.artwork).not.toMatch(/<(script|filter|image|animate)\b/);
      expect(theme.artwork).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});

describe('independent theme preferences', () => {
  it('uses Classic without writing when no preference exists', () => {
    const memory = storage();
    const preference = new ThemePreference(() => memory);
    expect(preference.current.id).toBe('classic');
    expect(preference.warning).toBeUndefined();
    expect(memory.writes).toEqual([]);
  });

  it.each(['classic', 'dark', 'medieval'])('restores %s without rewriting it', id => {
    const memory = storage(id);
    expect(new ThemePreference(() => memory).current.id).toBe(id);
    expect(memory.writes).toEqual([]);
  });

  it('reports an unknown preference without deleting or overwriting it', () => {
    const memory = storage('removed-theme');
    const preference = new ThemePreference(() => memory);
    expect(preference.current.id).toBe('classic');
    expect(preference.warning).toContain('not available');
    expect(memory.values.get(THEME_STORAGE_KEY)).toBe('removed-theme');
    expect(memory.writes).toEqual([]);
  });

  it('only writes the theme key and clears a resolved warning', () => {
    const memory = storage('unknown');
    memory.values.set('passport:locations:v1', 'travel data');
    memory.values.set('visited:locations:v1', 'legacy data');
    const preference = new ThemePreference(() => memory);
    preference.choose('medieval');
    expect(preference.current.id).toBe('medieval');
    expect(preference.warning).toBeUndefined();
    expect(memory.writes).toEqual([THEME_STORAGE_KEY]);
    expect(memory.values.get('passport:locations:v1')).toBe('travel data');
    expect(memory.values.get('visited:locations:v1')).toBe('legacy data');
  });

  it('reports denied access but permits a session-only theme choice', () => {
    const preference = new ThemePreference(() => { throw new Error('denied'); });
    expect(preference.warning).toContain('Could not read');
    preference.choose('dark');
    expect(preference.current.id).toBe('dark');
    expect(preference.warning).toContain('could not be remembered');
  });

  it('can save a later explicit choice after a read failure', () => {
    const writes: string[] = [];
    const preference = new ThemePreference(() => ({
      getItem() { throw new Error('read failed'); },
      setItem(key) { writes.push(key); },
    }));
    expect(preference.warning).toContain('read failed');
    preference.choose('dark');
    expect(preference.warning).toBeUndefined();
    expect(writes).toEqual([THEME_STORAGE_KEY]);
  });

  it('keeps the selected skin and old saved preference on write failure', () => {
    const memory = storage('classic');
    memory.setItem = () => { throw new Error('quota exceeded'); };
    const preference = new ThemePreference(() => memory);
    preference.choose('medieval');
    expect(preference.current.id).toBe('medieval');
    expect(preference.warning).toContain('quota exceeded');
    expect(memory.values.get(THEME_STORAGE_KEY)).toBe('classic');
  });

  it('rejects unsupported choices before mutating state or persistence', () => {
    const memory = storage('dark');
    const preference = new ThemePreference(() => memory);
    expect(() => preference.choose('unknown')).toThrow('Unknown theme');
    expect(preference.current.id).toBe('dark');
    expect(memory.writes).toEqual([]);
  });
});
