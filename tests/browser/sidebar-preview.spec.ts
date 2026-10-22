import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };
import type { LocationEntry, TravelStatus } from '../../src/types';

const pageErrors = new WeakMap<Page, string[]>();
const preview = (page: Page) => page.locator('.sidebar-country-preview');
const row = (page: Page, id: string) => page.locator(`.country-row[data-country="${id}"]`);
const boundary = (page: Page, id: string) => page.locator(`path.country-boundary[data-country="${id}"]`);
const statuses: Record<string, TravelStatus> = { EST: 'visited', FRA: 'lived', DEU: 'want_to_visit' };
const entries: LocationEntry[] = registry.filter((country) => statuses[country.id])
  .map(({ id, name, continent }) => ({ id, name, continent, status: statuses[id]! }));

async function ready(page: Page): Promise<void> {
  await page.addInitScript((data) => {
    if (localStorage.getItem('passport:locations:v1') === null) {
      localStorage.setItem('passport:locations:v1', JSON.stringify(data));
    }
  }, entries);
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
  await page.locator('.continent summary').filter({ has: page.getByText('Europe', { exact: true }) }).click();
  await page.mouse.move(0, 0);
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

test('hover reuses one outline without changing geometry, status, selection, storage or navigation', async ({ page }) => {
  await ready(page);
  const identity = await page.evaluateHandle(() => {
    const paths = [...document.querySelectorAll('path.country-boundary')];
    const geometry = paths.map((path) => path.getAttribute('d'));
    const outline = document.querySelector('.sidebar-country-preview');
    const transform = document.querySelector('.land-layer')!.getAttribute('transform');
    const storage = localStorage.getItem('passport:locations:v1');
    let writes = 0;
    const observer = new MutationObserver((records) => { writes += records.length; });
    paths.forEach((path) => observer.observe(path, { attributes: true, attributeFilter: ['d'] }));
    return () => ({
      samePaths: [...document.querySelectorAll('path.country-boundary')]
        .every((path, index) => path === paths[index] && path.getAttribute('d') === geometry[index]),
      sameOutline: document.querySelector('.sidebar-country-preview') === outline,
      sameTransform: document.querySelector('.land-layer')!.getAttribute('transform') === transform,
      sameStorage: localStorage.getItem('passport:locations:v1') === storage,
      writes,
    });
  });
  for (const id of ['EST', 'FRA', 'DEU', 'EST', 'FRA']) {
    const fill = await boundary(page, id).evaluate((element) => getComputedStyle(element).fill);
    await row(page, id).hover();
    await expect(preview(page)).toHaveAttribute('data-preview-country', id);
    await expect(preview(page)).toHaveAttribute('d', (await boundary(page, id).getAttribute('d'))!);
    await expect(preview(page)).toHaveCSS('fill', 'none');
    await expect(preview(page)).toHaveCSS('stroke-width', '3px');
    await expect(preview(page)).toHaveCSS('pointer-events', 'none');
    await expect(boundary(page, id)).toHaveCSS('fill', fill);
    await expect(page.locator('.status-popover')).toBeHidden();
    await expect(page.locator('.map-tooltip')).toBeHidden();
    await expect(page.locator('.country-boundary.is-selected')).toHaveCount(0);
  }
  await page.getByRole('searchbox').hover();
  await expect(preview(page)).toBeHidden();
  await expect(preview(page)).not.toHaveAttribute('data-preview-country');
  await expect(preview(page)).toHaveCount(1);
  expect(await identity.evaluate((read) => read())).toEqual({
    samePaths: true, sameOutline: true, sameTransform: true, sameStorage: true, writes: 0,
  });
  await identity.dispose();
});

test('keyboard focus previews a row, hover takes priority, and leaving restores focus', async ({ page }) => {
  await ready(page);
  await row(page, 'EST').focus();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await row(page, 'FRA').hover();
  await expect(row(page, 'EST')).toBeFocused();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'FRA');
  await page.getByRole('searchbox').hover();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await page.keyboard.press('Tab');
  await expect(page.locator('.country-favourite[data-country="EST"]')).toBeFocused();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await page.keyboard.press('Tab');
  const focusedId = await page.locator('.country-row:focus').getAttribute('data-country');
  expect(focusedId).not.toBe('EST');
  await expect(preview(page)).toHaveAttribute('data-preview-country', focusedId!);
  await page.getByRole('searchbox').focus();
  await expect(preview(page)).toBeHidden();
});

test('filtering, no results and collapsed groups clear stale hover and focus previews', async ({ page }) => {
  await ready(page);
  await row(page, 'EST').hover();
  await page.getByRole('searchbox').fill('nothing-matches');
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(preview(page)).toBeHidden();
  await page.getByRole('searchbox').clear();
  await page.getByRole('searchbox').hover();
  await row(page, 'EST').focus();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await page.locator('.continent').filter({ has: page.getByText('Europe', { exact: true }) }).evaluate((element) => {
    if (!(element instanceof HTMLDetailsElement)) throw new Error('Expected continent details');
    element.open = false;
  });
  await expect(row(page, 'EST')).toBeHidden();
  await expect(preview(page)).toBeHidden();
  await page.getByRole('searchbox').fill('France');
  await row(page, 'FRA').focus();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'FRA');
  await page.getByRole('searchbox').fill('Estonia');
  await expect(preview(page)).toBeHidden();
});

test('preview is independent of selection and works with keyboard status choices and live counts', async ({ page }) => {
  await ready(page);
  await row(page, 'EST').click();
  await expect(boundary(page, 'EST')).toHaveClass(/is-selected/);
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox').hover();
  await expect(row(page, 'EST')).toBeFocused();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await row(page, 'FRA').hover();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'FRA');
  await expect(boundary(page, 'EST')).toHaveClass(/is-selected/);
  await expect(boundary(page, 'FRA')).not.toHaveClass(/is-selected/);
  await expect(page.locator('.status-popover')).toBeHidden();
  await page.getByRole('searchbox').hover();
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-popover')).toBeVisible();
  await expect(preview(page)).toBeHidden();
  await page.getByRole('button', { name: 'Reset (Unvisited)', exact: true }).click();
  await page.getByRole('searchbox').hover();
  await expect(row(page, 'EST')).toBeFocused();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await expect(boundary(page, 'EST')).toHaveAttribute('data-status', 'unvisited');
  const europe = page.locator('.continent').filter({ has: page.getByText('Europe', { exact: true }) });
  const total = registry.filter((country) => country.kind === 'iso' && country.continent === 'Europe').length;
  await expect(europe.locator('.continent-count')).toHaveText(`(1/${total})`);
});

test('confirmed imports update existing rows and fills without persisting transient previews', async ({ page }) => {
  await ready(page);
  await row(page, 'EST').focus();
  const originalRow = await row(page, 'EST').elementHandle();
  const imported = [
    { id: 'EST', name: 'Estonia', continent: 'Europe', status: 'lived' },
    { id: 'custom:KOS', name: 'Kosovo', continent: 'Europe', status: 'visited' },
  ];
  await page.locator('#import-file').setInputFiles({
    name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await page.getByRole('searchbox').hover();
  await row(page, 'EST').focus();
  expect(await originalRow!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await expect(boundary(page, 'EST')).toHaveAttribute('data-status', 'lived');
  await expect(preview(page)).toHaveAttribute('d', (await boundary(page, 'EST').getAttribute('d'))!);
  const total = registry.filter((country) => country.kind === 'iso' && country.continent === 'Europe').length;
  await expect(page.locator('.continent').filter({ has: page.getByText('Europe', { exact: true }) })
    .locator('.continent-count')).toHaveText(`(1/${total})`);
  await page.reload();
  await expect(boundary(page, 'EST')).toHaveAttribute('data-status', 'lived');
  await expect(preview(page)).toBeHidden();
});

test('tiny ISO and non-ISO territories and Antarctica get their own marker rings and real outlines', async ({ page }) => {
  await ready(page);
  for (const id of ['VAT', 'custom:SCR', 'custom:KNX', 'ATA']) {
    await page.getByRole('searchbox').fill(id);
    await row(page, id).hover();
    await expect(preview(page)).toHaveAttribute('data-preview-country', id);
    await expect(preview(page)).toHaveAttribute('d', (await boundary(page, id).getAttribute('d'))!);
    const marker = page.locator(`.microstate-marker[data-country="${id}"]`);
    if (registry.find((country) => country.id === id)!.microstate) {
      await expect(marker).toHaveClass(/is-previewed/);
      await expect(page.locator('.microstate-marker.is-previewed')).toHaveCount(1);
      await expect(marker.locator('.marker-dot')).toHaveCSS('r', '7px');
      await expect(marker.locator('.marker-dot')).toHaveCSS('stroke-width', '3px');
      await expect(marker.locator('.marker-target')).toHaveAttribute('r', '12');
    }
  }
  await page.getByRole('searchbox').hover();
  await expect(preview(page)).toBeHidden();
  await expect(page.locator('.microstate-marker.is-previewed')).toHaveCount(0);
});

test('preview is click-through and leaves existing polygon selection usable', async ({ page }) => {
  await ready(page);
  await page.getByRole('searchbox').fill('BRA');
  await row(page, 'BRA').focus();
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'BRA');
  const point = await boundary(page, 'BRA').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    return { x, y, target: document.elementFromPoint(x, y)?.getAttribute('data-country') };
  });
  expect(point.target).toBe('BRA');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.popover-heading')).toContainText('Brazil');
  await expect(boundary(page, 'BRA')).toHaveClass(/is-selected/);
});

test('preview stays aligned through zoom and resize without changing its screen-space stroke', async ({ page }) => {
  await ready(page);
  await row(page, 'EST').focus();
  const land = page.locator('.land-layer');
  const initialTransform = await land.getAttribute('transform');
  await page.locator('.world-map').hover();
  await page.mouse.wheel(0, -400);
  await expect(land).not.toHaveAttribute('transform', initialTransform!);
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await expect(preview(page)).toHaveAttribute('d', (await boundary(page, 'EST').getAttribute('d'))!);
  const initialPath = await boundary(page, 'EST').getAttribute('d');
  await page.setViewportSize({ width: 1000, height: 820 });
  await expect(boundary(page, 'EST')).not.toHaveAttribute('d', initialPath!);
  await expect(preview(page)).toHaveAttribute('data-preview-country', 'EST');
  await expect(preview(page)).toHaveAttribute('d', (await boundary(page, 'EST').getAttribute('d'))!);
  await expect(preview(page)).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  await expect(preview(page)).toHaveCSS('stroke-width', '3px');
  expect(await preview(page).evaluate((element) => element.parentElement?.classList.contains('land-layer'))).toBe(true);
});

test('all skins use contrasting ink outlines without replacing any status fill', async ({ page }) => {
  await ready(page);
  for (const [theme, ink] of [
    ['classic', 'rgb(33, 54, 80)'], ['dark', 'rgb(245, 245, 247)'], ['medieval', 'rgb(56, 38, 15)'],
  ] as const) {
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    for (const id of ['EST', 'FRA', 'DEU', 'GBR']) {
      const fill = await boundary(page, id).evaluate((element) => getComputedStyle(element).fill);
      await row(page, id).hover();
      await expect(preview(page)).toHaveAttribute('data-preview-country', id);
      await expect(preview(page)).toHaveCSS('stroke', ink);
      await expect(preview(page)).toHaveCSS('fill', 'none');
      await expect(boundary(page, id)).toHaveCSS('fill', fill);
    }
  }
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 850 } });

  test('touch does not latch a hover preview, navigate the map or interfere with the status popover', async ({ page }) => {
    await ready(page);
    await page.getByRole('searchbox').fill('EST');
    await row(page, 'EST').scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    const transform = await page.locator('.land-layer').getAttribute('transform');
    await row(page, 'EST').dispatchEvent('pointerenter', { pointerType: 'touch' });
    await expect(preview(page)).toBeHidden();
    await row(page, 'EST').tap();
    await expect(page.locator('.status-popover')).toBeVisible();
    await expect(preview(page)).toBeHidden();
    await expect(boundary(page, 'EST')).toHaveClass(/is-selected/);
    await expect(page.locator('.land-layer')).toHaveAttribute('transform', transform!);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await page.getByRole('button', { name: 'Close status choices' }).tap();
    await page.getByRole('searchbox').focus();
    await expect(preview(page)).toBeHidden();
  });
});
