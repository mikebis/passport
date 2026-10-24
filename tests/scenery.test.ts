import { readFileSync } from 'node:fs';
import { geoBounds, geoContains, zoomIdentity } from 'd3';
import { describe, expect, it } from 'vitest';
import { createRouteSampler, projectedHeading, SCENERY_ROUTES, SceneryClock } from '../src/scenery';
import { decodeWorld, validateRegistry } from '../src/geography';
import registryJson from '../data/registry.json';
import { liveProjection, PROJECTIONS } from '../src/projection';

describe('scenery routes', () => {
  it('has a bounded, deterministic desktop and mobile scene', () => {
    expect(SCENERY_ROUTES).toHaveLength(9);
    expect(new Set(SCENERY_ROUTES.map((route) => route.id)).size).toBe(9);
    for (const [kind, desktop, mobile] of [['ship', 3, 2], ['plane', 2, 1], ['cloud', 4, 3]] as const) {
      expect(SCENERY_ROUTES.filter((route) => route.kind === kind)).toHaveLength(desktop);
      expect(SCENERY_ROUTES.filter((route) => route.kind === kind && route.mobile)).toHaveLength(mobile);
    }
  });

  it('interpolates by geographic distance and clamps endpoints', () => {
    const sample = createRouteSampler([[0, 0], [10, 0], [30, 0]]);
    expect(sample(-1)[0]).toBeCloseTo(0);
    expect(sample(.5)[0]).toBeCloseTo(15);
    expect(sample(1)[0]).toBeCloseTo(30);
    expect(sample(2)[0]).toBeCloseTo(30);
    expect(sample(.5)).toEqual(sample(.5));
  });

  it('supports repeated waypoints but rejects zero-length or malformed routes', () => {
    expect(createRouteSampler([[0, 0], [0, 0], [10, 0]])(.5)[0]).toBeCloseTo(5);
    expect(() => createRouteSampler([[0, 0]])).toThrow('at least two');
    expect(() => createRouteSampler([[0, 0], [0, 0]])).toThrow('nonzero');
    expect(() => createRouteSampler([[0, 0], [NaN, 0]])).toThrow('valid geographic');
    expect(() => createRouteSampler([[0, 0], [181, 0]])).toThrow('valid geographic');
    expect(() => createRouteSampler([[0, 0], [0, 90]])).toThrow('valid geographic');
    expect(() => createRouteSampler([[0, 0], [10, 0]])(Infinity)).toThrow('finite');
  });

  it.each(PROJECTIONS)('has finite $label positions and local headings throughout every track without date-line jumps', ({ id }) => {
    const projection = liveProjection(id, 1000, 650);
    for (const route of SCENERY_ROUTES) {
      const sample = createRouteSampler(route.points);
      let previousLongitude = sample(0)[0];
      for (let index = 0; index <= 200; index++) {
        const progress = index / 200;
        const position = sample(progress);
        expect(Math.abs(position[0] - previousLongitude)).toBeLessThan(180);
        previousLongitude = position[0];
        const projected = projection(position)!;
        const next = projection(sample(Math.min(1, progress + .001)))!;
        expect(projected.every(Number.isFinite)).toBe(true);
        const heading = projectedHeading(projected, next);
        expect(Number.isFinite(heading)).toBe(true);
        expect(heading).toBe(Math.atan2(next[1] - projected[1], next[0] - projected[0]) * 180 / Math.PI);
        const zoomed = zoomIdentity.translate(-20, 40).scale(24).apply(projected);
        expect(zoomed.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('keeps sampled ship tracks over real ocean, including small territories', () => {
    const world: unknown = JSON.parse(readFileSync(new URL('../data/world-10m.json', import.meta.url), 'utf8'));
    const { countries } = decodeWorld(world, validateRegistry(registryJson));
    const land = countries.features.map((boundary) => ({ boundary, bounds: geoBounds(boundary) }));
    for (const route of SCENERY_ROUTES.filter((item) => item.kind === 'ship')) {
      const sample = createRouteSampler(route.points);
      for (let index = 0; index <= 300; index++) {
        const point = sample(index / 300);
        for (const { boundary, bounds: [[west, south], [east, north]] } of land) {
          const inLongitude = west <= east ? point[0] >= west && point[0] <= east : point[0] >= west || point[0] <= east;
          if (inLongitude && point[1] >= south && point[1] <= north) {
            expect(geoContains(boundary, point), `${route.id} intersects ${boundary.id} at ${point.join(',')}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('projected headings', () => {
  it('orients vehicles toward their screen-space direction', () => {
    expect(projectedHeading([0, 0], [10, 0], 400)).toBe(0);
    expect(projectedHeading([0, 0], [0, 10], 400)).toBe(90);
    expect(projectedHeading([0, 0], [0, -10], 400)).toBe(-90);
    expect(projectedHeading([0, 0], [-10, 0], 400)).toBe(180);
  });
  it('does not point across the entire map when crossing the antimeridian', () => {
    expect(projectedHeading([398, 0], [2, 0], 400)).toBe(0);
    expect(projectedHeading([2, 0], [398, 0], 400)).toBe(180);
  });
});

describe('scenery clock', () => {
  it('only advances while running and resumes without hidden-time catch-up', () => {
    const clock = new SceneryClock();
    expect(clock.advance(100)).toBe(0);
    clock.setRunning(true);
    expect(clock.advance(100)).toBe(0);
    expect(clock.advance(116)).toBe(16);
    clock.setRunning(false);
    expect(clock.advance(100000)).toBe(16);
    clock.setRunning(true);
    expect(clock.advance(100000)).toBe(16);
    expect(clock.advance(100016)).toBe(32);
  });
  it('does not reset on repeated running updates or jump after a long foreground stall', () => {
    const clock = new SceneryClock();
    clock.setRunning(true);
    clock.advance(100);
    clock.setRunning(true);
    expect(clock.advance(120)).toBe(20);
    expect(clock.advance(100000)).toBe(120);
    expect(() => clock.advance(NaN)).toThrow('finite');
  });
});
