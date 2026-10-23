import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };
import { STATUSES, STATUS_LABELS, type LocationEntry, type TravelStatus } from '../../src/types';

const statuses: Record<string, TravelStatus> = {
  EST: 'visited', AUS: 'visited', 'custom:KOS': 'visited',
  FRA: 'lived', ATA: 'lived', DEU: 'want_to_visit', 'custom:SCR': 'want_to_visit',
};
const seed: LocationEntry[] = registry.filter((country) => statuses[country.id])
  .map(({ id, name, continent }) => ({ id, name, continent, status: statuses[id]! }));
const row = (page: Page, id: string) => page.locator(`.country-row[data-country="${id}"]`);
const filter = (page: Page, status: TravelStatus) => page.getByRole('button', { name: `Filter by ${STATUS_LABELS[status]}`, exact: true });
const shown = (page: Page) => page.locator('.country-row:not([hidden])');
const group = (page: Page, name: string) => page.locator('.continent').filter({ has: page.locator('summary > span:first-child', { hasText: new RegExp(`^${name}$`) }) });

async function ready(page: Page): Promise<void> {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('passport:locations:v1')) localStorage.setItem('passport:locations:v1', JSON.stringify(data));
  }, seed);
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}

async function expectIds(page: Page, ids: string[]): Promise<void> {
  await expect.poll(async () => (await shown(page).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-country')))).sort())
    .toEqual([...ids].sort());
  await expect(page.locator('.sidebar-meta')).toHaveText(`${ids.length} matching places`);
}

async function importEntries(page: Page, entries: LocationEntry[], confirm = true): Promise<void> {
  await page.locator('#import-file').setInputFiles({
    name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(entries)),
  });
  await page.getByRole('button', { name: confirm ? 'Replace data' : 'Cancel', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('four independent combinable toggles, all selected, last-off and explicit reset', async ({ page }) => {
  await ready(page);
  await expect(shown(page)).toHaveCount(registry.length);
  await expect(page.locator('.status-filter[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('.continent[open]')).toHaveCount(0);
  for (const status of STATUSES) {
    await filter(page, status).click();
    const expected = registry.filter((country) => (statuses[country.id] ?? 'unvisited') === status).map((country) => country.id);
    await expectIds(page, expected);
    await expect(filter(page, status)).toHaveAttribute('aria-pressed', 'true');
    await expect(filter(page, status)).toBeFocused();
    await filter(page, status).click();
    await expect(shown(page)).toHaveCount(registry.length);
    await expect(page.locator('.continent[open]')).toHaveCount(0);
  }
  await filter(page, 'visited').click();
  await filter(page, 'want_to_visit').click();
  await expectIds(page, ['EST', 'AUS', 'custom:KOS', 'DEU', 'custom:SCR']);
  await filter(page, 'lived').click();
  await filter(page, 'unvisited').click();
  await expectIds(page, registry.map((country) => country.id));
  await page.getByRole('button', { name: 'Show all statuses', exact: true }).click();
  await expect(page.locator('.status-filter[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('.continent[open]')).toHaveCount(0);
});

test('text intersects statuses in either order, including custom places, Antarctica and empty results', async ({ page }) => {
  await ready(page);
  const search = page.getByRole('searchbox');
  await filter(page, 'visited').click();
  await search.fill(' custom:kos ');
  await expectIds(page, ['custom:KOS']);
  await search.fill('FRA');
  await expectIds(page, []);
  await expect(page.locator('.empty-state')).toContainText('filters');
  await expect(page.locator('.continent:not([hidden])')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all statuses', exact: true }).click();
  await expect(search).toHaveValue('FRA');
  await expectIds(page, ['FRA']);
  await filter(page, 'lived').click();
  await expectIds(page, ['FRA']);
  await search.clear();
  await expectIds(page, ['FRA', 'ATA']);
  await search.fill('ata');
  await expectIds(page, ['ATA']);
  await expect(row(page, 'ATA')).toBeVisible();
  await filter(page, 'lived').click();
  await search.fill('reunion');
  await filter(page, 'unvisited').click();
  await expectIds(page, ['REU']);
  await search.fill('nonsense-no-match');
  await expectIds(page, []);
});

test('combined criteria temporarily expand groups and restore prior independent choices', async ({ page }) => {
  await ready(page);
  await group(page, 'Africa').locator('summary').click();
  await filter(page, 'visited').click();
  await expect(group(page, 'Europe')).toHaveAttribute('open');
  await expect(group(page, 'Africa')).toBeHidden();
  await group(page, 'Europe').locator('summary').click();
  await expect(group(page, 'Europe')).not.toHaveAttribute('open');
  await importEntries(page, seed);
  await expect(group(page, 'Europe')).not.toHaveAttribute('open');
  await page.getByRole('searchbox').fill('EST');
  await expect(group(page, 'Europe')).toHaveAttribute('open');
  await filter(page, 'visited').click();
  await expect(group(page, 'Europe')).toHaveAttribute('open');
  await page.getByRole('searchbox').clear();
  await expect(group(page, 'Europe')).not.toHaveAttribute('open');
  await expect(group(page, 'Africa')).toHaveAttribute('open');
  await expect(page.locator('.continent[open]')).toHaveCount(1);
});

test('status choices refilter immediately, recover focus and clear stale preview without losing selection', async ({ page }) => {
  await ready(page);
  await filter(page, 'visited').click();
  await row(page, 'EST').hover();
  await row(page, 'EST').click();
  await page.locator('.status-choice[data-status="lived"]').click();
  await expect(row(page, 'EST')).toBeHidden();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('.sidebar-country-preview')).toBeHidden();
  await expect(page.locator('path[data-country="EST"]')).toHaveClass(/is-selected/);
  await expectIds(page, ['AUS', 'custom:KOS']);
  await filter(page, 'lived').click();
  await row(page, 'EST').click();
  await page.locator('.status-choice[data-status="visited"]').click();
  await expect(row(page, 'EST')).toBeFocused();
  await expectIds(page, ['EST', 'AUS', 'custom:KOS', 'FRA', 'ATA']);
  await row(page, 'EST').press('Enter');
  await page.keyboard.press('Escape');
  await expect(row(page, 'EST')).toBeFocused();
});

test('every status transition changes membership and map edits can add an excluded place', async ({ page }) => {
  await ready(page);
  for (const status of STATUSES) {
    await page.getByRole('button', { name: 'Show all statuses', exact: true }).click();
    await filter(page, status).click();
    // Real SVG activation must remain independent of whether a sidebar row is included.
    await page.locator('path.country-boundary[data-country="BRA"]').dispatchEvent('click', { clientX: 200, clientY: 200 });
    await page.locator(`.status-choice[data-status="${status}"]`).click();
    await expect(row(page, 'BRA')).not.toHaveAttribute('hidden');
    for (const next of STATUSES.filter((value) => value !== status)) {
      await page.locator('path.country-boundary[data-country="BRA"]').dispatchEvent('click', { clientX: 200, clientY: 200 });
      await page.locator(`.status-choice[data-status="${next}"]`).click();
      await expect(row(page, 'BRA')).toBeHidden();
      await page.locator('path.country-boundary[data-country="BRA"]').dispatchEvent('click', { clientX: 200, clientY: 200 });
      await page.locator(`.status-choice[data-status="${status}"]`).click();
      await expect(row(page, 'BRA')).toBeVisible();
    }
  }
});

test('imports replace live membership, cancelled imports do not, and filters never persist with travel data', async ({ page }) => {
  await ready(page);
  await filter(page, 'visited').click();
  const oldRow = await row(page, 'EST').elementHandle();
  const replacement: LocationEntry[] = [{ id: 'ATA', name: 'Antarctica', continent: 'Antarctica', status: 'visited' }];
  await importEntries(page, replacement, false);
  await expectIds(page, ['EST', 'AUS', 'custom:KOS']);
  await importEntries(page, replacement);
  await expectIds(page, ['ATA']);
  expect(await oldRow!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(group(page, 'Europe')).toBeHidden();
  await expect(row(page, 'ATA')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /filter/i.test(key)))).toEqual([]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('passport:locations:v1')!) as LocationEntry[]);
  expect(saved).toHaveLength(registry.length);
  expect(saved.every((entry) => STATUSES.includes(entry.status))).toBe(true);
  await page.reload();
  await expect(page.locator('.status-filter[aria-pressed="true"]')).toHaveCount(0);
  await expect(shown(page)).toHaveCount(registry.length);
  await expect(page.locator('.continent[open]')).toHaveCount(0);
  await expect(page.locator('path[data-country="ATA"]')).toHaveAttribute('data-status', 'visited');
});

test('failed saves still refilter in memory and report the independent saving error', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:locations:v1') throw new DOMException('Storage full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await filter(page, 'visited').click();
  await row(page, 'EST').click();
  await page.locator('.status-choice[data-status="unvisited"]').click();
  await expectIds(page, ['AUS', 'custom:KOS']);
  await expect(page.locator('#save-status')).toContainText('Not saved');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('path[data-country="EST"]')).toHaveAttribute('data-status', 'unvisited');
});

test('filtering preserves map nodes, geometry, zoom, travel totals and full-continent progress', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.land-layer')).not.toHaveAttribute('transform', 'translate(0,0) scale(1)');
  await expect(page.locator('svg.world-map')).not.toHaveAttribute('data-navigating', 'true');
  const identity = await page.evaluateHandle(() => {
    const paths = [...document.querySelectorAll('.country-boundary')];
    const scenery = [...document.querySelectorAll('.scenery-object')];
    const geometry = paths.map((node) => node.getAttribute('d'));
    const transform = document.querySelector('.land-layer')!.getAttribute('transform');
    const data = localStorage.getItem('passport:locations:v1');
    return () => ({
      samePaths: [...document.querySelectorAll('.country-boundary')].every((node, index) => node === paths[index] && node.getAttribute('d') === geometry[index]),
      sameScenery: [...document.querySelectorAll('.scenery-object')].every((node, index) => node === scenery[index]),
      sameTransform: document.querySelector('.land-layer')!.getAttribute('transform') === transform,
      sameData: localStorage.getItem('passport:locations:v1') === data,
    });
  });
  const totals = await page.locator('.travel-stats').innerText();
  const counts = await page.locator('.continent-count').allTextContents();
  await filter(page, 'visited').click();
  await filter(page, 'want_to_visit').click();
  expect(await page.locator('.travel-stats').innerText()).toBe(totals);
  expect(await page.locator('.continent-count').allTextContents()).toEqual(counts);
  expect(await identity.evaluate((read) => read())).toEqual({ samePaths: true, sameScenery: true, sameTransform: true, sameData: true });
  await identity.dispose();
});

test('keyboard toggles, stable rows and focus recovery during an external replacement', async ({ page }) => {
  await ready(page);
  await filter(page, 'visited').focus();
  await page.keyboard.press('Space');
  await expect(filter(page, 'visited')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'visited')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(filter(page, 'visited')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await page.mouse.move(0, 0);
  await row(page, 'EST').focus();
  const original = await row(page, 'EST').elementHandle();
  await row(page, 'EST').press('Enter');
  const scroll = await page.locator('#country-groups').evaluate((node) => node.scrollTop);
  await page.locator('.status-choice[data-status="visited"]').click();
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(row(page, 'EST')).toBeFocused();
  expect(await page.locator('#country-groups').evaluate((node) => node.scrollTop)).toBe(scroll);
  // Focus a row at the persistence boundary, after import's modal has closed
  // and before store subscribers receive the replacement.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (key === 'passport:locations:v1') {
        (document.querySelector('.country-row[data-country="EST"]') as HTMLButtonElement).focus();
      }
    };
    const focusEvents: string[] = [];
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof Element) focusEvents.push(event.target.matches('input[type="search"]') ? 'search' : event.target.id || event.target.className);
    });
    Reflect.set(window, 'filterFocusEvents', focusEvents);
  });
  await importEntries(page, []);
  expect(await page.evaluate(() => Reflect.get(window, 'filterFocusEvents'))).toContain('search');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
  await expect(page.locator('.sidebar-country-preview')).toBeHidden();
  await expectIds(page, []);
  await filter(page, 'visited').focus();
  await page.keyboard.press('Tab');
  await expect(filter(page, 'lived')).toBeFocused();
});

test('selections survive themes, desktop hiding and mobile transitions without changing travel data', async ({ page }) => {
  await ready(page);
  await filter(page, 'visited').click();
  await filter(page, 'want_to_visit').click();
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await expectIds(page, ['EST', 'AUS', 'custom:KOS', 'DEU', 'custom:SCR']);
  for (const theme of ['dark', 'medieval', 'classic']) {
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    await expect(filter(page, 'visited')).toHaveAttribute('aria-pressed', 'true');
    await expectIds(page, ['EST', 'AUS', 'custom:KOS', 'DEU', 'custom:SCR']);
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await expectIds(page, ['EST', 'AUS', 'custom:KOS', 'DEU', 'custom:SCR']);
  await page.setViewportSize({ width: 1000, height: 720 });
  await expect(filter(page, 'want_to_visit')).toHaveAttribute('aria-pressed', 'true');
});

for (const theme of ['classic', 'dark', 'medieval']) {
  test(`${theme} compact neutral buttons keep legend-colored dots on one line in narrow/short layouts`, async ({ page }) => {
    await ready(page);
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    const continentSpacing = await page.locator('.continent').evaluateAll((groups) => groups.map((node) => {
      const style = getComputedStyle(node);
      return [style.borderTopWidth, style.paddingTop, style.marginTop, style.marginBottom];
    }));
    expect(continentSpacing).toHaveLength(7);
    for (const spacing of continentSpacing) expect(spacing).toEqual(continentSpacing[0]);
    const examples: Record<TravelStatus, string> = { visited: 'EST', lived: 'FRA', want_to_visit: 'DEU', unvisited: 'BRA' };
    for (const status of STATUSES) {
      const button = filter(page, status);
      const dot = button.locator('.status-dot');
      const fill = await page.locator(`path.country-boundary[data-country="${examples[status]}"]`).evaluate((node) => getComputedStyle(node).fill);
      const neutral = await page.locator('.search-box').evaluate((node) => getComputedStyle(node).backgroundColor);
      await expect(button).toHaveText('');
      await expect(button).toHaveAttribute('title', `Filter by ${STATUS_LABELS[status]}`);
      await expect(dot).toHaveAttribute('aria-hidden', 'true');
      for (const pressed of [false, true]) {
        if (pressed) await button.click();
        await page.mouse.move(0, 0);
        await expect(dot).toHaveCSS('background-color', fill);
        if (!pressed) await expect(button).toHaveCSS('background-color', neutral);
        await expect(button).not.toHaveCSS('background-color', fill);
        await expect(button).toHaveAttribute('aria-pressed', String(pressed));
        await expect(button.locator('..').locator('.status-filter')).toHaveCount(4);
        const ratio = await button.evaluate((node) => {
          const style = getComputedStyle(node);
          const luminance = (rgb: string): number => rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number)
            .map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, .7152, .0722][index]!, 0);
          const a = luminance(style.color), b = luminance(style.backgroundColor);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        });
        expect(ratio, `${theme} neutral control contrast`).toBeGreaterThanOrEqual(4.5);
        await expect(button).toHaveCSS('border-top-width', pressed ? '2px' : '1px');
        await button.hover();
        await expect(dot).toHaveCSS('background-color', fill);
        await expect(button).not.toHaveCSS('background-color', fill);
      }
      await button.click();
      await button.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(button).toHaveCSS('outline-width', '3px');
    }
    for (const size of [{ width: 1000, height: 620 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size);
      await page.locator('.google-sync summary').click();
      await filter(page, 'visited').click();
      const bounds = await page.locator('#country-groups').boundingBox();
      expect(bounds!.height).toBeGreaterThan(80);
      await row(page, 'EST').scrollIntoViewIfNeeded();
      await expect(row(page, 'EST')).toBeInViewport();
      await page.locator('.data-license a').first().scrollIntoViewIfNeeded();
      await expect(page.locator('.data-license a').first()).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const buttonBounds = await filter(page, 'lived').boundingBox();
      expect(buttonBounds!.width).toBe(32);
      const controls = await page.locator('.status-filters > button').evaluateAll((buttons) => buttons.map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      }));
      expect(controls).toHaveLength(6);
      expect(new Set(controls.map((rect) => rect.y)).size).toBe(1);
      const label = page.locator('.status-filters-label');
      await expect(label).toHaveText('Filters');
      await expect(label).toBeVisible();
      const labelBounds = await label.boundingBox();
      expect(labelBounds!.x + labelBounds!.width).toBeLessThan(controls[0]!.x);
      expect(Math.abs(labelBounds!.y + labelBounds!.height / 2 - (controls[0]!.y + controls[0]!.height / 2))).toBeLessThan(1);
      for (const rect of controls) {
        expect(rect.width).toBe(32);
        expect(rect.height).toBe(32);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(size.width);
      }
      await expect(page.getByRole('button', { name: 'Show all statuses', exact: true })).toHaveAttribute('title', 'Show all statuses');
      await filter(page, 'visited').click();
      await page.locator('.google-sync summary').click();
    }
  });
}
