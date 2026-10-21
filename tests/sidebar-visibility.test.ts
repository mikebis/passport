import { describe, expect, it } from 'vitest';
import { SidebarPreference, SIDEBAR_STORAGE_KEY, type SidebarStorage } from '../src/sidebar-visibility';

function storage(saved?: string): SidebarStorage & { values: Map<string, string>; writes: string[] } {
  const values = new Map(saved === undefined ? [] : [[SIDEBAR_STORAGE_KEY, saved]]);
  const writes: string[] = [];
  return {
    values, writes,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
  };
}

describe('independent desktop sidebar preference', () => {
  it('starts shown without writing a preference', () => {
    const memory = storage();
    const preference = new SidebarPreference(() => memory);
    expect(preference.visible).toBe(true);
    expect(preference.warning).toBeUndefined();
    expect(memory.writes).toEqual([]);
  });

  it.each(['shown', 'hidden'])('restores %s without rewriting it', saved => {
    const memory = storage(saved);
    const preference = new SidebarPreference(() => memory);
    expect(preference.visible).toBe(saved === 'shown');
    expect(preference.warning).toBeUndefined();
    expect(memory.writes).toEqual([]);
  });

  it('shows the sidebar and explains an invalid preference without replacing it', () => {
    const memory = storage('invalid');
    const preference = new SidebarPreference(() => memory);
    expect(preference.visible).toBe(true);
    expect(preference.warning).toContain('not recognized');
    expect(memory.values.get(SIDEBAR_STORAGE_KEY)).toBe('invalid');
    expect(memory.writes).toEqual([]);
  });

  it('writes only its own key on explicit choices and resolves an invalid preference', () => {
    const memory = storage('invalid');
    for (const key of ['passport:theme:v1', 'passport:locations:v1', 'passport:drive:link:v1']) {
      memory.values.set(key, 'unchanged');
    }
    const preference = new SidebarPreference(() => memory);
    preference.choose(false);
    expect(preference.visible).toBe(false);
    expect(memory.values.get(SIDEBAR_STORAGE_KEY)).toBe('hidden');
    expect(preference.warning).toBeUndefined();
    preference.choose(true);
    expect(memory.values.get(SIDEBAR_STORAGE_KEY)).toBe('shown');
    expect(memory.writes).toEqual([SIDEBAR_STORAGE_KEY, SIDEBAR_STORAGE_KEY]);
    expect([...memory.values].filter(([key]) => key !== SIDEBAR_STORAGE_KEY).every(([, value]) => value === 'unchanged')).toBe(true);
  });

  it('reports denied storage and still allows session-only visibility changes', () => {
    const preference = new SidebarPreference(() => { throw new Error('access denied'); });
    expect(preference.visible).toBe(true);
    expect(preference.warning).toContain('access denied');
    preference.choose(false);
    expect(preference.visible).toBe(false);
    expect(preference.warning).toContain('could not be remembered');
  });

  it('can remember a later choice after a read failure', () => {
    const writes: string[] = [];
    const preference = new SidebarPreference(() => ({
      getItem() { throw new Error('read failed'); },
      setItem(key) { writes.push(key); },
    }));
    expect(preference.warning).toContain('read failed');
    preference.choose(false);
    expect(preference.warning).toBeUndefined();
    expect(writes).toEqual([SIDEBAR_STORAGE_KEY]);
  });

  it('retains a session choice on write failure and clears its warning after successful retry', () => {
    const memory = storage('shown');
    const write = memory.setItem;
    memory.setItem = () => { throw new Error('quota exceeded'); };
    const preference = new SidebarPreference(() => memory);
    preference.choose(false);
    expect(preference.visible).toBe(false);
    expect(preference.warning).toContain('quota exceeded');
    expect(memory.values.get(SIDEBAR_STORAGE_KEY)).toBe('shown');
    memory.setItem = write;
    preference.choose(true);
    expect(preference.warning).toBeUndefined();
    expect(memory.values.get(SIDEBAR_STORAGE_KEY)).toBe('shown');
  });
});
