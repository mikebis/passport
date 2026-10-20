import { expect, test, type Page } from '@playwright/test';
import { geoMercator } from 'd3';
import registry from '../../data/registry.json' with { type: 'json' };
import { CONTINENTS, type LocationEntry } from '../../src/types';

const crimeanPoints: [string, [number, number]][] = [
  ['Simferopol', [34.1024, 44.9521]], ['Sevastopol', [33.55, 44.6]],
  ['Yalta', [34.165, 44.495]], ['Kerch', [36.47, 45.356]],
];
const seed: LocationEntry[] = registry.filter((country) => ['UKR', 'RUS'].includes(country.id))
  .map(({ id, name, continent }) => ({
    id, name, continent, status: id === 'UKR' ? 'want_to_visit' : 'lived', updatedAt: '2026-01-01T12:00:00.000Z',
    subdivisions: [{
      id: id === 'UKR' ? 'UA-43' : 'RU-MOW', name: id === 'UKR' ? 'Crimea' : 'Moscow',
      continent, status: 'visited', updatedAt: '2026-01-01T12:00:00.000Z',
    }],
  }));
const pageErrors = new WeakMap<Page, string[]>();
const boundary = (page: Page, id: string) => page.locator(`path.country-boundary[data-country="${id}"]`);

async function ready(page: Page): Promise<void> {
  await page.addInitScript((data) => {
    if (localStorage.getItem('passport:locations:v1') === null) {
      localStorage.setItem('passport:locations:v1', JSON.stringify(data));
    }
  }, seed);
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}

async function screenPoint(page: Page, coordinates: [number, number]): Promise<{ x: number; y: number }> {
  const { width, height } = await page.locator('.world-map').evaluate((element) => {
    if (!(element instanceof SVGSVGElement)) throw new Error('Missing map SVG');
    return { width: element.viewBox.baseVal.width, height: element.viewBox.baseVal.height };
  });
  const projected = geoMercator().scale(Math.min(width / (2 * Math.PI), height / 3.1) * .94)
    .translate([width / 2, height * .58])(coordinates);
  if (!projected) throw new Error('Cannot project Crimean test point');
  return page.locator('.land-layer').evaluate((element, [x, y]) => {
    if (!(element instanceof SVGGraphicsElement)) throw new Error('Missing land layer');
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Missing map screen transform');
    const point = new DOMPoint(x, y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, projected);
}

async function zoomCrimea(page: Page): Promise<void> {
  const point = await screenPoint(page, [34.1024, 44.9521]);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -3000);
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', /scale\(24\)/);
  // D3 ends its wheel gesture after 150 ms of inactivity.
  await page.waitForTimeout(200);
}

async function countryAt(page: Page, coordinates: [number, number]): Promise<{ id: string | null; fill: string }> {
  const point = await screenPoint(page, coordinates);
  return page.evaluate(({ x, y }) => {
    const country = document.elementFromPoint(x, y)?.closest('path.country-boundary');
    if (!country) throw new Error('No country at the projected Crimean point');
    return { id: country.getAttribute('data-country'), fill: getComputedStyle(country).fill };
  }, point);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test('Crimean cities, including Sevastopol, hit Ukraine and open its tooltip and status controls', async ({ page }) => {
  await ready(page);
  const stored = await page.evaluate(() => localStorage.getItem('passport:locations:v1'));
  await zoomCrimea(page);
  for (const [name, coordinates] of crimeanPoints) {
    expect((await countryAt(page, coordinates)).id, name).toBe('UKR');
    const point = await screenPoint(page, coordinates);
    await page.mouse.move(point.x, point.y);
    await expect(page.getByRole('tooltip')).toContainText('Ukraine');
    await expect(page.getByRole('tooltip')).toContainText('UKR');
    await expect(page.getByRole('tooltip')).toContainText('Want to Visit');
    await expect(page.getByRole('tooltip')).not.toContainText('Russia');
  }
  const sevastopol = await screenPoint(page, [33.55, 44.6]);
  await page.mouse.click(sevastopol.x, sevastopol.y);
  await expect(page.locator('.popover-heading')).toContainText('Ukraine');
  await expect(page.locator('.status-choice[data-status="want_to_visit"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(stored);
});

test('Crimea follows Ukraine across status edits, Russia edits, themes and reload without losing data', async ({ page }) => {
  await ready(page);
  await zoomCrimea(page);
  const point = await screenPoint(page, [34.1024, 44.9521]);
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  await expect(boundary(page, 'UKR')).toHaveAttribute('data-status', 'visited');
  await expect(boundary(page, 'RUS')).toHaveAttribute('data-status', 'lived');
  await page.getByRole('searchbox').fill('RUS');
  await page.locator('.country-row[data-country="RUS"]').click();
  await page.getByRole('button', { name: 'Reset (Unvisited)', exact: true }).click();
  for (const theme of ['classic', 'dark', 'medieval']) {
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    const ukrainianFill = await boundary(page, 'UKR').evaluate((element) => getComputedStyle(element).fill);
    const russianFill = await boundary(page, 'RUS').evaluate((element) => getComputedStyle(element).fill);
    expect(ukrainianFill).not.toBe(russianFill);
    for (const [name, coordinates] of crimeanPoints) {
      expect(await countryAt(page, coordinates), name).toEqual({ id: 'UKR', fill: ukrainianFill });
    }
  }
  const data: LocationEntry[] = await page.evaluate(() => JSON.parse(localStorage.getItem('passport:locations:v1')!));
  for (const entry of seed) expect(data.find((country) => country.id === entry.id)?.subdivisions).toEqual(entry.subdivisions);
  expect(data).toHaveLength(registry.length);
  await page.reload();
  await expect(boundary(page, 'UKR')).toHaveAttribute('data-status', 'visited');
  await expect(boundary(page, 'RUS')).toHaveAttribute('data-status', 'unvisited');
  await expect(page.locator('.country-row')).toHaveCount(registry.length);
  await expect(page.locator('.continent')).toHaveCount(CONTINENTS.length);
  const europeTotal = registry.filter((country) => country.kind === 'iso' && country.continent === 'Europe').length;
  await expect(page.locator('.continent').filter({ has: page.getByText('Europe', { exact: true }) })
    .locator('.continent-count')).toHaveText(`(1/${europeTotal})`);
  await expect(page.locator('#colored-count')).toHaveText(`1 / ${registry.length}`);
});

test('Ukraine and Russia sidebar previews use the corrected boundaries without moving the map', async ({ page }) => {
  await ready(page);
  await zoomCrimea(page);
  const transform = await page.locator('.land-layer').getAttribute('transform');
  for (const id of ['UKR', 'RUS']) {
    await page.getByRole('searchbox').fill(id);
    await page.locator(`.country-row[data-country="${id}"]`).hover();
    const preview = page.locator('.sidebar-country-preview');
    await expect(preview).toHaveAttribute('data-preview-country', id);
    await expect(preview).toHaveAttribute('d', (await boundary(page, id).getAttribute('d'))!);
    await expect(page.locator('.land-layer')).toHaveAttribute('transform', transform!);
    for (const [name, coordinates] of crimeanPoints) {
      expect((await countryAt(page, coordinates)).id, name).toBe('UKR');
    }
  }
});
