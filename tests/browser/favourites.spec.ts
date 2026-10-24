import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };
import { STATUSES, type LocationEntry, type TravelStatus } from '../../src/types';

const statuses: Record<string, TravelStatus> = { SVK: 'visited', AUT: 'lived', CZE: 'want_to_visit', FRA: 'unvisited' };
const seed: LocationEntry[] = registry.filter((country) => statuses[country.id])
  .map(({ id, name, continent }) => ({
    id, name, continent, status: statuses[id]!,
    ...(id === 'SVK' ? { subdivisions: [{ id: 'SK-BL', name: 'Bratislava', continent, status: 'lived' as const }] } : {}),
  }));
const row = (page: Page, id: string) => page.locator(`.country-row[data-country="${id}"]`);
const star = (page: Page, id: string) => page.locator(`.country-favourite[data-country="${id}"]`);
const path = (page: Page, id: string) => page.locator(`path.country-boundary[data-country="${id}"]`);
const errors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function ready(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((entries) => {
    if (localStorage.getItem('passport:locations:v1') === null) {
      localStorage.setItem('passport:locations:v1', JSON.stringify(entries));
    }
  }, seed);
  await page.route('**/data/badges.json', (route) => route.fulfill({ json: [
    { name: 'Neighbours', description: 'Visit or live in Slovakia and Czechia.', condition: 'SVK + CZE', value: 10 },
  ] }));
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}
async function find(page: Page, id: string): Promise<void> {
  await page.getByRole('searchbox').fill(id);
  await expect(row(page, id)).toBeVisible();
}
async function upload(page: Page, entries: unknown): Promise<void> {
  await page.locator('#import-file').setInputFiles({
    name: 'favourites.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(entries)),
  });
}
async function mapStatus(page: Page, id: string, status: TravelStatus): Promise<void> {
  await path(page, id).dispatchEvent('click', { clientX: 100, clientY: 100 });
  await page.locator(`.status-choice[data-status="${status}"]`).click();
}

async function expectVisible(page: Page, ids: string[]): Promise<void> {
  await expect.poll(() => page.locator('.country-row:not([hidden])').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-country')).sort())).toEqual([...ids].sort());
  await expect(page.locator('.sidebar-meta')).toHaveText(`${ids.length} matching places`);
}

test('star filter intersects favourites with status and search, supports keyboard and resets only on reload', async ({ page }) => {
  await ready(page);
  const filter = page.getByRole('button', { name: 'Filter by Favourites', exact: true });
  await expect(filter).toHaveText('\u2605');
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await filter.focus();
  await page.keyboard.press('Space');
  await expectVisible(page, []);
  await expect(page.locator('.empty-state')).toContainText('filters');
  await expect(filter).toBeFocused();
  await page.keyboard.press('Enter');
  const favourites = ['SVK', 'AUT', 'CZE', 'FRA', 'custom:KOS', 'ATA'];
  for (const id of favourites) {
    await find(page, id);
    await star(page, id).click();
  }
  await page.getByRole('searchbox').clear();
  const saved = await page.evaluate(() => localStorage.getItem('passport:locations:v1'));
  await filter.click();
  await expectVisible(page, favourites);
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(filter).toHaveCSS('border-top-width', '2px');
  await expect(page.locator('.continent:not([hidden]):not([open])')).toHaveCount(0);
  await filter.click();
  await expect(page.locator('.continent[open]')).toHaveCount(0);
  await filter.click();
  await page.getByRole('button', { name: 'Filter by Visited', exact: true }).click();
  await page.getByRole('button', { name: 'Filter by Want to Visit', exact: true }).click();
  await expectVisible(page, ['SVK', 'CZE']);
  await page.getByRole('searchbox').fill('CZE');
  await expectVisible(page, ['CZE']);
  await page.getByRole('button', { name: 'Show all statuses', exact: true }).click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expectVisible(page, ['CZE']);
  await page.getByRole('searchbox').clear();
  await expectVisible(page, favourites);
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await expect(page.locator('[data-stat="completed"]')).toHaveText('2/266 (0.8%)');
  await page.getByRole('tab', { name: 'Manage countries', exact: true }).click();
  await page.locator('#theme-picker').selectOption('dark');
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expectVisible(page, favourites);
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(saved);
  await page.reload();
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.country-row:not([hidden])')).toHaveCount(registry.length);
  await expect(path(page, 'SVK')).toHaveAttribute('data-favourite', 'true');
});

test('favourite-filter membership updates live and hidden stars recover focus after edits and imports', async ({ page }) => {
  await ready(page);
  await find(page, 'SVK');
  await star(page, 'SVK').click();
  await page.getByRole('searchbox').clear();
  const filter = page.getByRole('button', { name: 'Filter by Favourites', exact: true });
  await filter.click();
  await expectVisible(page, ['SVK']);
  await star(page, 'SVK').focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Space');
  await expectVisible(page, []);
  await expect(star(page, 'SVK')).toBeHidden();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('.sidebar-country-preview')).toBeHidden();
  await expect(path(page, 'SVK')).toHaveAttribute('data-status', 'visited');
  await path(page, 'custom:KOS').dispatchEvent('click', { clientX: 100, clientY: 100 });
  await page.locator('.favourite-choice').click();
  await expectVisible(page, ['custom:KOS']);
  await expect(page.locator('.favourite-choice')).toBeFocused();
  await page.keyboard.press('Escape');
  await upload(page, seed.map((entry) => ({ ...entry, favourite: entry.id === 'CZE' })));
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expectVisible(page, ['CZE']);
  await upload(page, seed);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectVisible(page, ['CZE']);
  await upload(page, seed);
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expectVisible(page, []);
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
});

test('sidebar stars and popover toggles are independent native controls with preserved status and focus', async ({ page }) => {
  await ready(page);
  await find(page, 'SVK');
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'false');
  await expect(star(page, 'SVK')).toHaveText('\u2606');
  await expect(page.locator('button button')).toHaveCount(0);
  await row(page, 'SVK').focus();
  await page.keyboard.press('Tab');
  await expect(star(page, 'SVK')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(star(page, 'SVK')).toHaveText('\u2605');
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await expect(star(page, 'SVK')).toBeFocused();
  await expect(path(page, 'SVK')).toHaveAttribute('data-favourite', 'true');
  await expect(path(page, 'SVK')).toHaveAttribute('data-status', 'visited');
  await expect(page.locator('.status-popover')).toBeHidden();
  await expect(page.locator('.country-boundary.is-selected')).toHaveCount(0);
  await expect(page.locator('.sidebar-country-preview')).toHaveAttribute('data-preview-country', 'SVK');
  await page.keyboard.press('Enter');
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'false');
  await row(page, 'SVK').click();
  const favourite = page.locator('.favourite-choice');
  await favourite.focus();
  await page.keyboard.press('Space');
  await expect(favourite).toHaveAttribute('aria-pressed', 'true');
  await expect(favourite).toBeFocused();
  await expect(page.locator('.status-popover')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close status choices', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(favourite).toBeFocused();
  await page.locator('.status-choice[data-status="unvisited"]').click();
  await expect(row(page, 'SVK')).toBeFocused();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await expect(path(page, 'SVK')).toHaveAttribute('data-status', 'unvisited');
  await row(page, 'SVK').click();
  await page.locator('.favourite-choice').click();
  await page.keyboard.press('Escape');
  await expect(row(page, 'SVK')).toBeFocused();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'false');
});

test('all statuses, additional places and Antarctica can be favourited without changing totals or badges', async ({ page }) => {
  await ready(page);
  for (const id of ['SVK', 'AUT', 'CZE', 'FRA', 'custom:KOS', 'ATA']) {
    await find(page, id);
    await star(page, id).click();
    await expect(path(page, id)).toHaveAttribute('data-favourite', 'true');
    await expect(path(page, id)).toHaveAttribute('data-status', statuses[id] ?? 'unvisited');
  }
  await expect(path(page, 'SRB')).toHaveAttribute('data-favourite', 'false');
  await expect(page.locator('#visited-count')).toHaveText('1');
  await expect(page.locator('#lived-count')).toHaveText('1');
  await expect(page.locator('#wish-count')).toHaveText('1');
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await expect(page.locator('[data-stat="completed"]')).toHaveText('2/266 (0.8%)');
  await page.getByRole('tab', { name: 'Badges', exact: true }).click();
  await expect(page.locator('.badge-progress-text')).toHaveText('1/2');
  await expect(page.locator('#badge-summary')).toContainText('0/10 points');
  await page.reload();
  await expect(path(page, 'custom:KOS')).toHaveAttribute('data-favourite', 'true');
  await expect(path(page, 'ATA')).toHaveAttribute('data-favourite', 'true');
  await expect(path(page, 'SVK')).toHaveAttribute('data-status', 'visited');
  await find(page, 'SVK');
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
});

test('favourites export and import with subdivisions, cancellation, legacy defaults and strict validation', async ({ page }) => {
  await ready(page);
  await find(page, 'SVK');
  await star(page, 'SVK').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export data' }).click();
  const stream = await (await downloaded).createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString();
  const exported = JSON.parse(text) as LocationEntry[];
  expect(exported.find((entry) => entry.id === 'SVK')).toMatchObject({
    favourite: true, status: 'visited', subdivisions: seed.find((entry) => entry.id === 'SVK')!.subdivisions,
  });
  await upload(page, []);
  await expect(page.getByRole('dialog')).toContainText('1 favourite flags');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await upload(page, [{ ...seed[0], favourite: 'yes' }]);
  await expect(page.locator('#toast')).toContainText('Favourite flag');
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await upload(page, seed);
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'false');
  await expect(path(page, 'SVK')).toHaveAttribute('data-status', 'visited');
  await upload(page, exported);
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
});

test('favourite edits preserve filtered membership, row identity, search and map geometry through tabs and hiding', async ({ page }) => {
  await ready(page);
  await path(page, 'FRA').dispatchEvent('click', { clientX: 100, clientY: 100 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await find(page, 'SVK');
  await page.getByRole('button', { name: 'Filter by Visited', exact: true }).click();
  const identity = await page.evaluateHandle(() => {
    const nodes = [...document.querySelectorAll('.country-row,.country-boundary,.scenery-object')];
    const geometry = [...document.querySelectorAll('.country-boundary')].map((node) => node.getAttribute('d'));
    const transform = document.querySelector('.land-layer')!.getAttribute('transform');
    return () => [...document.querySelectorAll('.country-row,.country-boundary,.scenery-object')].every((node, index) => node === nodes[index])
      && [...document.querySelectorAll('.country-boundary')].every((node, index) => node.getAttribute('d') === geometry[index])
      && document.querySelector('.land-layer')!.getAttribute('transform') === transform;
  });
  await star(page, 'SVK').click();
  await expect(star(page, 'SVK')).toBeFocused();
  await expect(row(page, 'SVK')).toBeVisible();
  await expect(path(page, 'FRA')).toHaveClass(/is-selected/);
  expect(await identity.evaluate((check) => check())).toBe(true);
  await page.getByRole('tab', { name: 'Badges', exact: true }).click();
  await page.getByRole('tab', { name: 'Manage countries', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('SVK');
  await expect(page.getByRole('button', { name: 'Filter by Visited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await expect.poll(() => page.locator('.world-map').evaluate((node: SVGSVGElement) =>
    Math.abs(node.viewBox.baseVal.width - node.getBoundingClientRect().width) < .1)).toBe(true);
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await mapStatus(page, 'SVK', 'unvisited');
  await expect(row(page, 'SVK')).toBeHidden();
  await expect(star(page, 'SVK')).toBeHidden();
  await page.getByRole('button', { name: 'Show all statuses', exact: true }).click();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await identity.dispose();
});

test('an external replacement hiding a focused star recovers focus and clears the preview', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Filter by Visited', exact: true }).click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (key === 'passport:locations:v1') {
        document.querySelector<HTMLButtonElement>('.country-favourite[data-country="SVK"]')!.focus();
      }
    };
    const focusEvents: string[] = [];
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof Element && event.target.matches('input[type="search"]')) focusEvents.push('search');
    });
    Reflect.set(window, 'favouriteFocusEvents', focusEvents);
  });
  await upload(page, []);
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'favouriteFocusEvents'))).toContain('search');
  await expect(star(page, 'SVK')).toBeHidden();
  await expect(page.locator('.sidebar-country-preview')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
});

test('failed local saves still update favourite stars and flags in memory', async ({ page }) => {
  await ready(page);
  await find(page, 'SVK');
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:locations:v1') throw new DOMException('Full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await star(page, 'SVK').click();
  await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
  await expect(path(page, 'SVK')).toHaveAttribute('data-favourite', 'true');
  await expect(page.locator('#save-status')).toContainText('Not saved');
  await expect(path(page, 'SVK')).toHaveAttribute('data-status', 'visited');
  await page.getByRole('button', { name: 'Filter by Favourites', exact: true }).click();
  await expectVisible(page, ['SVK']);
  await star(page, 'SVK').click();
  await expectVisible(page, []);
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('#save-status')).toContainText('Not saved');
});

for (const theme of ['classic', 'dark', 'medieval']) {
  test(`${theme} favourites preserve normal boundaries, previews, marker rings and narrow layouts`, async ({ page }) => {
    await ready(page);
    await page.locator('#theme-picker').selectOption(theme);
    await find(page, 'SVK');
    const boundary = await path(page, 'SVK').evaluate((node) => ({
      stroke: getComputedStyle(node).stroke, width: getComputedStyle(node).strokeWidth,
    }));
    const previewStroke = await page.locator('.sidebar-country-preview').evaluate((node) => getComputedStyle(node).stroke);
    await star(page, 'SVK').click();
    await expect(path(page, 'SVK')).toHaveCSS('stroke', boundary.stroke);
    await expect(path(page, 'SVK')).toHaveCSS('stroke-width', boundary.width);
    await expect(page.locator('.sidebar-country-preview')).toHaveCSS('stroke', previewStroke);
    await expect(page.locator('.sidebar-country-preview')).toHaveCSS('stroke-width', '3px');
    for (const status of STATUSES) {
      await mapStatus(page, 'SVK', status);
      await expect(path(page, 'SVK')).toHaveCSS('stroke', boundary.stroke);
      await expect(path(page, 'SVK')).toHaveCSS('stroke-width', '1.5px');
      await expect(path(page, 'SVK')).toHaveAttribute('data-status', status);
      await expect(star(page, 'SVK')).toHaveAttribute('aria-pressed', 'true');
      const fill = await page.locator(`.map-legend .status-dot.${status}`).evaluate((node) => getComputedStyle(node).backgroundColor);
      await expect(path(page, 'SVK')).toHaveCSS('fill', fill);
    }
    await find(page, 'VAT');
    await page.mouse.move(0, 0);
    const marker = page.locator('.microstate-marker[data-country="VAT"] .marker-dot');
    const markerStroke = await marker.evaluate((node) => getComputedStyle(node).stroke);
    await star(page, 'VAT').click();
    await expect(page.locator('.microstate-marker[data-country="VAT"]')).toHaveAttribute('data-favourite', 'true');
    await expect(marker).toHaveCSS('stroke', previewStroke);
    await expect(marker).toHaveCSS('stroke-width', '3px');
    await page.getByRole('searchbox').focus();
    await page.mouse.move(0, 0);
    await expect(marker).toHaveCSS('stroke', markerStroke);
    await expect(marker).toHaveCSS('stroke-width', '1px');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(path(page, 'SVK')).toHaveCSS('stroke', boundary.stroke);
    await expect(path(page, 'SVK')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
    await path(page, 'SVK').dispatchEvent('pointermove', { clientX: 100, clientY: 100 });
    await expect(page.getByRole('tooltip')).toContainText('Favourite');
    for (const size of [{ width: 1000, height: 620 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size);
      await find(page, 'custom:SPI');
      await expect(star(page, 'custom:SPI')).toBeVisible();
      await star(page, 'custom:SPI').click();
      await expect(star(page, 'custom:SPI')).toHaveAttribute('aria-pressed', size.width === 1000 ? 'true' : 'false');
      await page.locator('#export-data').scrollIntoViewIfNeeded();
      await expect(page.locator('#export-data')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (size.width === 1000) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    }
    await find(page, 'SVK');
    await star(page, 'SVK').click();
    await expect(path(page, 'SVK')).toHaveAttribute('data-favourite', 'false');
    await expect(path(page, 'SVK')).toHaveCSS('stroke', boundary.stroke);
  });
}
