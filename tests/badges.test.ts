import { describe, expect, it } from 'vitest';
import registryJson from '../data/registry.json';
import { validateRegistry } from '../src/geography';
import { badgeCountryIds, evaluateBadge, parseBadges, parseCondition } from '../src/badges';
import { STATUSES, type TravelStatus } from '../src/types';

const registry = validateRegistry(registryJson);
const definition = { name: 'Neighbours', description: 'Visit neighbouring countries.', condition: '(SVK | CZE)', value: 10 };
const evaluate = (condition: string, ids: string[] = [], status: TravelStatus = 'visited') =>
  evaluateBadge(parseCondition(condition, registry), (id) => ids.includes(id) ? status : 'unvisited');

describe('badge formulas', () => {
  it('lists distinct referenced countries in formula order across every operator', () => {
    const condition = parseCondition('(SVK | CZE) + (AUT, DEU, FRA){2} + (SVK | (custom:KOS + ATA))', registry);
    expect(badgeCountryIds(condition)).toEqual(['SVK', 'CZE', 'AUT', 'DEU', 'FRA', 'custom:KOS', 'ATA']);
    expect(badgeCountryIds(parseCondition('SVK', registry))).toEqual(['SVK']);
  });
  it('handles the supplied OR, AND, paired OR and threshold examples', () => {
    expect(evaluate('(SVK | CZE)', ['SVK', 'CZE'])).toEqual({ completed: 1, total: 1, earned: true });
    expect(evaluate('(SVK + CZE + AUT)', ['SVK', 'CZE'])).toEqual({ completed: 2, total: 3, earned: false });
    expect(evaluate('(SVK | CZE) + (AUT | DEU)', ['CZE'])).toEqual({ completed: 1, total: 2, earned: false });
    expect(evaluate('(SVK | CZE) + (AUT | DEU)', ['SVK', 'CZE', 'DEU'])).toEqual({ completed: 2, total: 2, earned: true });
    expect(evaluate('(SVK, CZE, AUT){2}', ['SVK'])).toEqual({ completed: 1, total: 2, earned: false });
    expect(evaluate('(SVK, CZE, AUT){2}', ['SVK', 'CZE', 'AUT'])).toEqual({ completed: 2, total: 2, earned: true });
  });
  it('uses exact top-level visited/lived status and can lose an award', () => {
    for (const status of STATUSES) {
      const earned = status === 'visited' || status === 'lived';
      expect(evaluate('SVK', ['SVK'], status)).toEqual({ completed: Number(earned), total: 1, earned });
    }
    expect(evaluate('SVK')).toEqual({ completed: 0, total: 1, earned: false });
  });
  it('gives a ten-country threshold exactly four completed units and 40%', () => {
    const ids = ['SVK', 'CZE', 'AUT', 'DEU', 'FRA', 'ITA', 'ESP', 'PRT', 'POL', 'EST'];
    const result = evaluate(`(${ids.join(',')}){10}`, ids.slice(0, 4));
    expect(result).toEqual({ completed: 4, total: 10, earned: false });
    expect(result.completed / result.total * 100).toBe(40);
  });
  it('supports nested groups, conventional precedence, fractional OR and overlapping requirements', () => {
    expect(evaluate('SVK | CZE + AUT', ['SVK']).earned).toBe(true);
    expect(evaluate('(SVK | CZE) + AUT', ['SVK']).earned).toBe(false);
    expect(evaluate('((SVK + CZE) | AUT)', ['SVK'])).toEqual({ completed: .5, total: 1, earned: false });
    expect(evaluate('(SVK | CZE) + (SVK | AUT)', ['SVK'])).toEqual({ completed: 2, total: 2, earned: true });
    expect(evaluate('((SVK,CZE){1} + (AUT | DEU))', ['SVK', 'DEU']).earned).toBe(true);
    expect(evaluate('(ATA + custom:KOS)', ['ATA', 'custom:KOS'], 'lived').earned).toBe(true);
  });
  it.each([
    '', 'GER', 'svk', 'XXX', 'custom:XXX', 'SVK CZE', 'SVK +', '| SVK', '(SVK', 'SVK)',
    '()', '(SVK,CZE)', '(SVK,CZE){0}', '(SVK,CZE){3}', '(SVK,SVK){2}',
    '(SVK,CZE){1.5}', '(SVK,CZE){-1}', '(SVK,CZE){Infinity}', '(SVK,CZE){1',
    '(SVK + CZE){2}', '(SVK | CZE,AUT){2}', 'SVK && CZE', 'eval(SVK)', 'SVK;alert(1)',
    '(SVK,CZE){9007199254740992}', 'SVK{1}', 'Europe{10}',
  ])('rejects invalid formula %s explicitly', (source) => {
    expect(() => parseCondition(source, registry)).toThrow();
  });
  it('bounds input and nesting while allowing flat expressions without recursive operator chains', () => {
    expect(() => parseCondition('('.repeat(32) + 'SVK' + ')'.repeat(32), registry)).not.toThrow();
    expect(() => parseCondition('('.repeat(33) + 'SVK' + ')'.repeat(33), registry)).toThrow('32 nesting');
    expect(() => parseCondition(' '.repeat(4097), registry)).toThrow('4096');
    expect(evaluate(Array(800).fill('SVK').join('+'), ['SVK'])).toEqual({ completed: 800, total: 800, earned: true });
  });
});

describe('badge catalog validation', () => {
  it('accepts an empty catalog and the exact four-field points schema', () => {
    expect(parseBadges([], registry)).toEqual([]);
    expect(parseBadges([definition], registry)[0]).toMatchObject({ name: 'Neighbours', value: 10, condition: { kind: 'or' } });
    expect(parseBadges([{ ...definition, value: 0 }], registry)[0]?.value).toBe(0);
  });
  it.each([
    null, {}, [null], [{ ...definition, value: -1 }], [{ ...definition, value: .5 }],
    [{ ...definition, value: '10' }], [{ ...definition, value: Infinity }],
    [{ ...definition, name: '' }], [{ ...definition, description: ' ' }], [{ ...definition, condition: '' }],
    [{ ...definition, id: 'extra' }], [{ name: 'Missing fields' }], [{ ...definition, name: 'x'.repeat(121) }],
    [{ ...definition, description: 'x'.repeat(1001) }], Array(501).fill(definition),
  ])('rejects malformed catalogs', (value) => { expect(() => parseBadges(value, registry)).toThrow(); });
  it('reports badge names/positions and rejects duplicate names and unsafe total points', () => {
    expect(() => parseBadges([{ ...definition, condition: 'GER' }], registry)).toThrow(/Badge 1 "Neighbours".*position 1/);
    expect(() => parseBadges([definition, { ...definition, name: ' neighbours ' }], registry)).toThrow('duplicate');
    expect(() => parseBadges([{ ...definition, value: Number.MAX_SAFE_INTEGER }, { ...definition, name: 'Second', value: 1 }], registry)).toThrow('Total badge points');
  });
});
