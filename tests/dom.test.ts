import { describe, expect, it } from 'vitest';
import { uniqueId } from '../src/dom';

describe('shared DOM helpers', () => {
  it('generates distinct IDs for simultaneous dialogs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => uniqueId('confirmation-title')));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^confirmation-title-\d+$/);
  });
});
