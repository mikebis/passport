import { expect, test, type Page } from '@playwright/test';
import { PROJECTIONS } from '../../src/projection';

const key = 'passport:projection:v1';
const picker = (page: Page) => page.getByRole('combobox', { name: 'Projection', exact: true });
const boundary = (page: Page, id: string) => page.locator(`.country-boundary[data-country="${id}"]`);

async function ready(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(266);
}

test('Equal Earth is the unwritten default and the neighboring selector remembers keyboard choices', async ({ page }) => {
  await ready(page);
  await expect(picker(page)).toHaveValue('equal-earth');
  await expect(page.locator('.world-map')).toHaveAttribute('data-projection', 'equal-earth');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(picker(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveValue('mercator');
  await expect(page.locator('.world-map')).toHaveAttribute('data-projection', 'mercator');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('mercator');
  await page.reload();
  await expect(picker(page)).toHaveValue('mercator');
  await expect(page.locator('.world-map')).toHaveAttribute('data-projection', 'mercator');
  await picker(page).selectOption('equal-earth');
  await page.reload();
  await expect(picker(page)).toHaveValue('equal-earth');
});

test('switching redraws existing map nodes, resets zoom and preserves selection, travel data and scenery phase', async ({ page }) => {
  await ready(page);
  await page.getByRole('searchbox').fill('France');
  await page.locator('.country-row[data-country="FRA"]').click();
  await page.keyboard.press('Escape');
  await expect(boundary(page, 'FRA')).toHaveClass(/is-selected/);
  const entries = await page.evaluate(() => localStorage.getItem('passport:locations:v1'));
  const original = await boundary(page, 'FRA').getAttribute('d');
  await page.locator('.world-map').evaluate(node => {
    Reflect.set(window, '__projectionNodes', [...node.querySelectorAll('.country-boundary, .scenery-object, .microstate-marker')]);
  });
  const initialPoses = await page.locator('.scenery-object').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', /scale\(1.7\)/);
  await picker(page).focus();
  await picker(page).selectOption('mercator');
  await expect(picker(page)).toBeFocused();
  await expect(page.locator('.land-layer')).toHaveAttribute('transform', 'translate(0,0) scale(1)');
  expect(await boundary(page, 'FRA').getAttribute('d')).not.toBe(original);
  await expect(boundary(page, 'FRA')).toHaveClass(/is-selected/);
  await expect(page.getByRole('searchbox')).toHaveValue('France');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toBeHidden();
  await picker(page).selectOption('equal-earth');
  expect(await boundary(page, 'FRA').getAttribute('d')).toBe(original);
  expect(await page.locator('.scenery-object').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(initialPoses);
  expect(await page.locator('.world-map').evaluate(node => {
    const before: unknown = Reflect.get(window, '__projectionNodes');
    return Array.isArray(before) && [...node.querySelectorAll('.country-boundary, .scenery-object, .microstate-marker')]
      .every((item, index) => item === before[index]);
  })).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(entries);
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'reduced');
});

test('invalid saved projection and failed writes have independent recoverable warnings', async ({ page }) => {
  await page.addInitScript(key => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, 'removed-projection');
      localStorage.setItem('passport:theme:v1', 'dark');
      sessionStorage.setItem('seeded', 'true');
    }
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !Reflect.get(window, '__allowProjectionWrite')) throw new Error('Projection quota exceeded');
      set.call(this, name, value);
    };
  }, key);
  await ready(page);
  await expect(picker(page)).toHaveValue('equal-earth');
  await expect(page.locator('#projection-message')).toContainText('not available');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('removed-projection');
  await picker(page).selectOption('mercator');
  await expect(page.locator('.world-map')).toHaveAttribute('data-projection', 'mercator');
  await expect(page.locator('#projection-message')).toContainText('could not be remembered');
  await expect(page.locator('#theme-message')).toBeHidden();
  await expect(page.locator('#warning')).toBeHidden();
  await expect(page.locator('#theme-picker')).toHaveValue('dark');
  await page.evaluate(() => Reflect.set(window, '__allowProjectionWrite', true));
  await picker(page).selectOption('equal-earth');
  await expect(page.locator('#projection-message')).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('equal-earth');
});

test('denied projection reads preserve local editing and allow a later explicit save', async ({ page }) => {
  await page.addInitScript(key => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new Error('Projection read denied');
      return get.call(this, name);
    };
  }, key);
  await ready(page);
  await expect(page.locator('#projection-message')).toContainText('Projection read denied');
  await picker(page).selectOption('mercator');
  await expect(page.locator('#projection-message')).toBeHidden();
  await expect(page.locator('#theme-message')).toBeHidden();
  await expect(page.locator('#warning')).toBeHidden();
  await page.getByRole('searchbox').fill('custom:KOS');
  await page.locator('.country-row[data-country="custom:KOS"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('switching projections preserves paused and hidden scenery without restarting its phase', async ({ page }) => {
  await ready(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Pause map animations', exact: true }).click();
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  const poses = () => page.locator('.scenery-object').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  const before = await poses();
  await picker(page).selectOption('mercator');
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  expect(await poses()).not.toEqual(before);
  await picker(page).selectOption('equal-earth');
  expect(await poses()).toEqual(before);
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  await picker(page).selectOption('mercator');
  await expect(page.locator('.map-scenery')).toBeHidden();
  await picker(page).selectOption('equal-earth');
  await page.getByRole('button', { name: 'Show map scenery', exact: true }).click();
  await expect(page.locator('.map-scenery')).toHaveAttribute('data-motion', 'paused');
  expect(await poses()).toEqual(before);
});

for (const theme of ['classic', 'dark', 'medieval']) {
  test(`${theme}: projection controls and both maps fit narrow layouts and keep polar/tiny places selectable`, async ({ page }, testInfo) => {
    await ready(page);
    await page.locator('#theme-picker').selectOption(theme);
    await page.getByRole('tab', { name: 'Save/Export', exact: true }).click();
    await page.getByRole('tab', { name: 'Countries', exact: true }).click();
    for (const [width, height] of [[1000, 620], [740, 620], [320, 800]]) {
      await page.setViewportSize({ width: width!, height: height! });
      const themeBox = (await page.locator('#theme-picker').boundingBox())!;
      const projectionBox = (await picker(page).boundingBox())!;
      expect(projectionBox.y).toBe(themeBox.y);
      expect(projectionBox.x).toBeGreaterThan(themeBox.x + themeBox.width);
      for (const projection of PROJECTIONS) {
        await picker(page).selectOption(projection.id);
        await expect(page.locator('.world-map')).toHaveAttribute('data-projection', projection.id);
        const finite = await page.locator('.world-map').evaluate(svg =>
          [...svg.querySelectorAll('.country-boundary, .microstate-marker, .scenery-object')]
            .every(node => !/NaN|Infinity/.test(`${node.getAttribute('d')} ${node.getAttribute('transform')}`)));
        expect(finite).toBe(true);
        for (const id of ['ATA', 'VAT', 'custom:KOS']) {
          await page.getByRole('searchbox').fill(id);
          const row = page.locator(`.country-row[data-country="${id}"]`);
          await row.focus();
          await expect(page.locator('.sidebar-country-preview')).toHaveAttribute('data-preview-country', id);
          expect(await page.locator('.sidebar-country-preview').getAttribute('d')).toBe(await boundary(page, id).getAttribute('d'));
          await row.press('Enter');
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(boundary(page, id)).toHaveClass(/is-selected/);
        }
        const marker = await page.locator('.microstate-marker[data-country="ATA"]').evaluate((node: SVGGElement) => {
          const svg = node.ownerSVGElement!;
          const matrix = node.transform.baseVal.consolidate()!.matrix;
          return { y: matrix.f, height: svg.viewBox.baseVal.height };
        });
        expect(marker.y).toBeGreaterThan(0);
        expect(marker.y).toBeLessThan(marker.height);
        if (width === 1000) await page.screenshot({ path: testInfo.outputPath(`map-${theme}-${projection.id}.png`) });
        if (width === 320) await page.locator('.display-settings').screenshot({ path: testInfo.outputPath(`settings-${theme}-${projection.id}-mobile.png`) });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width! > 720) expect(await page.locator('.country-groups').evaluate(node => node.clientHeight)).toBeGreaterThan(90);
      await page.getByRole('link', { name: 'View on GitHub', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('link', { name: 'View on GitHub', exact: true })).toBeInViewport();
    }
  });
}
