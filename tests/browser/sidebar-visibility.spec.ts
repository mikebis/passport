import { expect, test, type Page } from '@playwright/test';
import { findProjection, liveProjection, PROJECTIONS } from '../../src/projection';

declare global {
  interface Window {
    sidebarWriteKeys: string[];
  }
}

const sidebarKey = 'passport:sidebar:v1';
const summary = (page: Page, name: string) =>
  page.locator('.continent summary').filter({ has: page.getByText(name, { exact: true }) });

async function ready(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(266);
}

async function mapView(page: Page) {
  const view = await page.locator('.world-map').evaluate(element => {
    if (!(element instanceof SVGSVGElement)) throw new Error('Missing map');
    const land = element.querySelector('.land-layer');
    if (!(land instanceof SVGGraphicsElement)) throw new Error('Missing land layer');
    const matrix = land.transform.baseVal.consolidate()!.matrix;
    return { width: element.viewBox.baseVal.width, height: element.viewBox.baseVal.height, k: matrix.a, x: matrix.e, y: matrix.f, projectionId: element.dataset.projection };
  });
  const selected = findProjection(view.projectionId ?? '');
  if (!selected) throw new Error('Missing map projection');
  const projection = liveProjection(selected.id, view.width, view.height);
  return { ...view, center: projection.invert!([(view.width / 2 - view.x) / view.k, (view.height / 2 - view.y) / view.k])! };
}

test('desktop starts shown and keyboard hiding gives the whole map its space, with a remembered choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Hide sidebar', exact: true });
  await expect(toggle).toHaveAttribute('aria-controls', 'places-sidebar');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(key => localStorage.getItem(key), sidebarKey)).toBeNull();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeFocused();
  await expect(page.locator('#toggle-sidebar')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect.poll(() => mapView(page).then(view => view.width)).toBe(1280);
  expect(await page.locator('.map-section').boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    expect(await page.locator('.sidebar').evaluate(node => node.contains(document.activeElement))).toBe(false);
  }
  await page.reload();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await expect.poll(() => mapView(page).then(view => view.width)).toBe(925);
  expect(await page.evaluate(key => localStorage.getItem(key), sidebarKey)).toBe('shown');
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
});

for (const saved of ['shown', 'hidden']) {
  test(`mobile always shows the sidebar without overwriting desktop ${saved}`, async ({ page }) => {
    await page.addInitScript(({ key, saved }) => {
      localStorage.setItem(key, saved);
      window.sidebarWriteKeys = [];
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        window.sidebarWriteKeys.push(key);
        set.call(this, key, value);
      };
    }, { key: sidebarKey, saved });
    await ready(page);
    for (const width of [720, 721, 360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const mobile = width <= 720;
      await expect(page.locator('.sidebar')).toBeVisible({ visible: mobile || saved === 'shown' });
      await expect(page.locator('#toggle-sidebar')).toBeVisible({ visible: !mobile });
      if (mobile) {
        await expect(page.getByRole('button', { name: /^(Show|Hide) sidebar$/ })).toHaveCount(0);
        const map = (await page.locator('.map-section').boundingBox())!;
        const sidebar = (await page.locator('.sidebar').boundingBox())!;
        expect(sidebar.y).toBe(map.y + map.height);
      }
      expect(await page.evaluate(key => localStorage.getItem(key), sidebarKey)).toBe(saved);
      expect(await page.evaluate(() => window.sidebarWriteKeys)).toEqual([]);
    }
  });
}

test('focus moves only when its control would become hidden at the mobile breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(page.getByRole('searchbox')).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.setViewportSize({ width: 721, height: 800 });
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.getByRole('searchbox').focus();
  await page.locator('#toggle-sidebar').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).focus();
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeFocused();
});

test('all seven groups start collapsed and search restores independent Europe and Antarctica choices', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.continent summary > span:first-child')).toHaveText([
    'Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America', 'Antarctica',
  ]);
  await expect(page.locator('.continent[open]')).toHaveCount(0);
  await summary(page, 'Europe').click();
  await summary(page, 'Antarctica').click();
  await expect(page.locator('.continent[open]')).toHaveCount(2);
  await expect(page.locator('.antarctica .country-row')).toBeVisible();
  await page.getByRole('searchbox').fill('Kenya');
  await expect(summary(page, 'Africa').locator('..')).toHaveAttribute('open');
  await page.getByRole('searchbox').clear();
  await expect(summary(page, 'Europe').locator('..')).toHaveAttribute('open');
  await expect(summary(page, 'Antarctica').locator('..')).toHaveAttribute('open');
  await expect(summary(page, 'Africa').locator('..')).not.toHaveAttribute('open');
  await summary(page, 'Antarctica').click();
  await page.getByRole('searchbox').fill('ATA');
  await expect(summary(page, 'Antarctica').locator('..')).toHaveAttribute('open');
  await page.locator('.country-row[data-country="ATA"]').click();
  await page.getByRole('button', { name: 'Visited', exact: true }).click();
  await expect(summary(page, 'Antarctica').locator('.continent-count')).toHaveText('(1/1)');
  await expect(page.locator('.antarctica .country-row .continent-count')).toHaveCount(0);
  await page.getByRole('searchbox').fill('nothing-matches');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.getByRole('searchbox').clear();
  await expect(summary(page, 'Antarctica').locator('..')).not.toHaveAttribute('open');
  await expect(summary(page, 'Europe').locator('..')).toHaveAttribute('open');
  await page.reload();
  await expect(page.locator('.continent[open]')).toHaveCount(0);
  await expect(summary(page, 'Antarctica').locator('.continent-count')).toHaveText('(1/1)');
});

for (const projection of PROJECTIONS) {
test(`${projection.label}: hiding preserves zoomed geographic center, nodes, search, group choices and selected country without stale previews`, async ({ page }) => {
  await page.addInitScript(id => localStorage.setItem('passport:projection:v1', id), projection.id);
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await summary(page, 'Europe').click();
  await page.getByRole('searchbox').fill('Estonia');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Hide map scenery', exact: true }).click();
  await page.locator('.country-row[data-country="EST"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar-country-preview')).toBeVisible();
  const identity = await page.evaluateHandle(() => {
    const selector = '.world-map, .country-boundary, .scenery-object, .country-row, #google-sync';
    const nodes = [...document.querySelectorAll(selector)];
    return () => [...document.querySelectorAll(selector)].every((node, index) => node === nodes[index]);
  });
  const original = await mapView(page);
  const data = await page.evaluate(() => localStorage.getItem('passport:locations:v1'));
  for (let index = 0; index < 3; index++) {
    await page.locator('.country-row[data-country="EST"]').focus();
    await expect(page.locator('.sidebar-country-preview')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.status-popover')).toBeVisible();
    await page.locator('#toggle-sidebar').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeFocused();
    await expect.poll(() => mapView(page).then(view => view.width)).toBe(1280);
    await expect(page.locator('.sidebar-country-preview')).toBeHidden();
    await expect(page.locator('.status-popover')).toBeHidden();
    const enlarged = await mapView(page);
    expect(enlarged.k).toBeCloseTo(original.k, 5);
    expect(enlarged.center[0]).toBeCloseTo(original.center[0], 5);
    expect(enlarged.center[1]).toBeCloseTo(original.center[1], 5);
    await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
    await expect.poll(() => mapView(page).then(view => view.width)).toBe(925);
    await expect(page.getByRole('searchbox')).toHaveValue('Estonia');
    await expect(page.locator('path[data-country="EST"]')).toHaveClass(/is-selected/);
    await expect(page.getByRole('button', { name: 'Show map scenery', exact: true })).toBeVisible();
    expect(await identity.evaluate(read => read())).toBe(true);
  }
  await page.getByRole('searchbox').clear();
  await expect(summary(page, 'Europe').locator('..')).toHaveAttribute('open');
  expect(await page.evaluate(() => localStorage.getItem('passport:locations:v1'))).toBe(data);
  await identity.dispose();
});
}

test('invalid and unreadable preferences visibly fall back to shown without affecting travel or theme warnings', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'unknown'), sidebarKey);
  await ready(page);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#sidebar-message')).toContainText('not recognized');
  expect(await page.evaluate(key => localStorage.getItem(key), sidebarKey)).toBe('unknown');
  await expect(page.locator('#warning:visible, #theme-message:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await expect(page.locator('#sidebar-message')).toBeHidden();
  await page.addInitScript(key => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new Error('Sidebar read denied');
      return get.call(this, name);
    };
  }, sidebarKey);
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#sidebar-message')).toContainText('Sidebar read denied');
  await expect(page.locator('#warning:visible, #theme-message:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await expect(page.locator('#sidebar-message')).toBeHidden();
});

test('write failures keep hiding usable, warn outside the sidebar and recover on a later choice', async ({ page }) => {
  await ready(page);
  const original = await page.evaluateHandle(() => Storage.prototype.setItem);
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('Sidebar write denied');
      set.call(this, name, value);
    };
  }, sidebarKey);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('#sidebar-message')).toContainText('could not be remembered');
  await expect(page.locator('#sidebar-message')).toBeInViewport();
  await expect(page.locator('#warning:visible, #theme-message:visible')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), sidebarKey)).toBeNull();
  await original.evaluate(set => { Storage.prototype.setItem = set; });
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await expect(page.locator('#sidebar-message')).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), sidebarKey)).toBe('shown');
  await original.dispose();
});

test('the floating toggle stays inside the map and themed at narrow and wide desktop sizes', async ({ page }) => {
  await ready(page);
  for (const width of [721, 1280, 1700]) {
    await page.setViewportSize({ width, height: 620 });
    for (const theme of ['classic', 'dark', 'medieval']) {
      await page.locator('#theme-picker').selectOption(theme);
      for (const name of ['Hide sidebar', 'Show sidebar']) {
        const toggle = page.getByRole('button', { name, exact: true });
        await expect(toggle).toBeInViewport();
        const bounds = (await toggle.boundingBox())!;
        const map = (await page.locator('.map-section').boundingBox())!;
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(map.x + map.width - 16);
        const legend = (await page.locator('.map-legend').boundingBox())!;
        expect(map.y + map.height - bounds.y - bounds.height).toBeCloseTo(16, 0);
        expect(bounds.y + bounds.height).toBeCloseTo(legend.y + legend.height, 0);
        expect(legend.x + legend.width + 12).toBeLessThanOrEqual(bounds.x);
        expect(bounds.height).toBeGreaterThanOrEqual(40);
        const paints = await toggle.evaluate(node => {
          const style = getComputedStyle(node);
          const legend = getComputedStyle(document.querySelector('.map-legend')!);
          return { panel: style.backgroundColor === legend.backgroundColor, ink: style.color === legend.color };
        });
        expect(paints).toEqual({ panel: true, ink: true });
        await toggle.click();
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
