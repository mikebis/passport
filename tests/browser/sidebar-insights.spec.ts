import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };
import { type LocationEntry, type TravelStatus } from '../../src/types';

const catalog = [
  { name: 'Either', description: 'Slovakia or Czechia.', condition: '(SVK | CZE)', value: 5 },
  { name: 'Trio', description: 'All three neighbours.', condition: '(SVK + CZE + AUT)', value: 10 },
  { name: 'Pairs', description: 'One from each pair.', condition: '(SVK | CZE) + (AUT | DEU)', value: 15 },
  { name: 'Ten', description: 'Ten explicit places.', condition: '(SVK,CZE,AUT,DEU,FRA,ITA,ESP,PRT,POL,EST){10}', value: 20 },
  { name: 'Nested', description: 'Best alternative.', condition: '(SVK + CZE) | DEU', value: 8 },
  { name: 'Additional', description: 'An additional place and Antarctica.', condition: 'custom:KOS + ATA', value: 2 },
];
const statuses: Record<string, TravelStatus> = { SVK: 'visited', AUT: 'lived', EST: 'visited', ATA: 'visited', DEU: 'want_to_visit', 'custom:KOS': 'visited' };
const entries: LocationEntry[] = registry.filter((country) => statuses[country.id])
  .map(({ id, name, continent }) => ({ id, name, continent, status: statuses[id]! }));
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const errors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function ready(page: Page, badges: unknown = catalog): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((data) => localStorage.setItem('passport:locations:v1', JSON.stringify(data)), entries);
  await page.route('**/data/badges.json', (route) => route.fulfill({ json: badges }));
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}
async function mapStatus(page: Page, id: string, status: TravelStatus): Promise<void> {
  await page.locator(`path.country-boundary[data-country="${id}"]`).dispatchEvent('click', { clientX: 100, clientY: 100 });
  await page.locator(`.status-choice[data-status="${status}"]`).click();
}
async function replace(page: Page, data: LocationEntry[]): Promise<void> {
  await page.locator('#import-file').setInputFiles({
    name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
}

test('tabs share only heading/credits and have complete keyboard and panel semantics', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('tablist', { name: 'Sidebar views' })).toBeVisible();
  await expect(tab(page, 'Countries')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Countries' })).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await tab(page, 'Countries').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Stats')).toBeFocused();
  await expect(tab(page, 'Stats')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('searchbox')).toBeHidden();
  await expect(page.locator('#theme-picker')).toBeHidden();
  await expect(page.locator('.travel-stats')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Your places.' })).toBeVisible();
  await expect(page.locator('#export-data')).toBeHidden();
  await expect(page.locator('#share-picture')).toBeHidden();
  await expect(page.locator('.data-license')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['Countries', 'Stats', 'Badges', 'Save/Export']);
  await page.keyboard.press('Tab');
  await expect(page.locator('#panel-stats')).toBeFocused();
  await tab(page, 'Stats').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Badges')).toBeFocused();
  await expect(page.locator('.badge-card')).toHaveCount(catalog.length);
  await page.keyboard.press('End');
  await expect(tab(page, 'Save/Export')).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Save/Export' })).toBeVisible();
  for (const selector of ['#save-status', '#export-data', '#copy-data', '#import-data', '#google-sync', '#share-picture']) {
    await expect(page.locator(`#panel-save-export ${selector}`)).toBeVisible();
  }
  await expect(page.locator('#share-picture')).toHaveText('Share picture');
  const panel = page.getByRole('tabpanel', { name: 'Save/Export', exact: true });
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Google Drive sync', 'Import / Export data', 'Sharing']);
  const data = panel.getByRole('region', { name: 'Import / Export data', exact: true });
  await expect(data.getByRole('button')).toHaveText(['Export data', 'Copy JSON', 'Import data']);
  await expect(data.locator('#save-status')).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Sharing', exact: true }).getByRole('button')).toHaveText('Share picture');
  for (const heading of await panel.getByRole('heading', { level: 3 }).all()) {
    await expect(heading).toHaveCSS('font-size', '16px');
    await expect(heading).toHaveCSS('font-weight', '600');
  }
  await expect(page.locator('.sidebar-heading #share-picture, .sidebar-footer button')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Countries')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'Save/Export')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, 'Countries')).toBeFocused();
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await tab(page, 'Badges').click();
  await page.reload();
  await expect(tab(page, 'Countries')).toHaveAttribute('aria-selected', 'true');
});

test('Stats counts all places independently of filters while Manage retains ISO-only continent ratios', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#visited-count')).toHaveText('4');
  await page.getByRole('searchbox').fill('SVK');
  await page.getByRole('button', { name: 'Filter by Visited', exact: true }).click();
  await tab(page, 'Stats').click();
  for (const [key, text] of Object.entries({ visited: '4', lived: '1', want_to_visit: '1', unvisited: '260', completed: '5/266 (1.9%)', continents: '2/7' })) {
    await expect(page.locator(`[data-stat="${key}"]`)).toHaveText(text);
  }
  await expect(page.locator('.continent-statistic')).toHaveCount(7);
  await expect(page.locator('.continent-statistic[data-continent="Europe"] > span')).toHaveText('4/57 (7%)');
  await expect(page.locator('.continent-statistic[data-continent="Antarctica"] > span')).toHaveText('1/1 (100%)');
  await expect(page.getByRole('progressbar', { name: 'Europe: places visited or lived in' })).toHaveAttribute('max', '57');
  await expect(page.locator('#panel-stats .insight-note')).not.toContainText('ISO');
  await mapStatus(page, 'CZE', 'lived');
  await expect(page.locator('[data-stat="lived"]')).toHaveText('2');
  await expect(page.locator('[data-stat="completed"]')).toHaveText('6/266 (2.3%)');
  await mapStatus(page, 'custom:SOL', 'visited');
  await expect(page.locator('[data-stat="completed"]')).toHaveText('7/266 (2.6%)');
  await expect(page.locator('[data-stat="continents"]')).toHaveText('3/7');
  await tab(page, 'Countries').click();
  await expect(page.locator('.continent').filter({ has: page.locator('summary', { hasText: 'Europe' }) }).locator('.continent-count')).toHaveText('(4/52)');
  await tab(page, 'Stats').click();
  await replace(page, []);
  await expect(page.locator('[data-stat="completed"]')).toHaveText('0/266 (0%)');
  await expect(page.locator('[data-stat="continents"]')).toHaveText('0/7');
  await expect(tab(page, 'Stats')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Countries').click();
  await expect(page.getByRole('searchbox')).toHaveValue('SVK');
  await expect(page.getByRole('button', { name: 'Filter by Visited', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('badges show exact formula progress, earn/lose points and update stable nodes after map edits and imports', async ({ page }) => {
  await ready(page);
  await tab(page, 'Badges').click();
  await expect(page.locator('#badge-summary')).toHaveText('3/6 badges earned \u00b7 22/60 points');
  for (const [name, progress] of [['Either', '1/1'], ['Trio', '2/3'], ['Pairs', '2/2'], ['Ten', '3/10'], ['Nested', '50%'], ['Additional', '2/2']]) {
    await expect(card(page, name!).locator('.badge-progress-text')).toHaveText(progress!);
  }
  const original = await card(page, 'Ten').elementHandle();
  await mapStatus(page, 'CZE', 'visited');
  await expect(card(page, 'Ten').locator('.badge-progress-text')).toHaveText('4/10');
  await expect(card(page, 'Ten').getByRole('progressbar')).toHaveAttribute('value', '4');
  await expect(card(page, 'Ten').getByRole('progressbar')).toHaveAttribute('max', '10');
  await expect(card(page, 'Ten').getByRole('progressbar')).toHaveAttribute('aria-valuetext', '4/10, 40%, In progress');
  await expect(page.locator('#badge-summary')).toHaveText('5/6 badges earned \u00b7 40/60 points');
  await expect(card(page, 'Trio')).toHaveAttribute('data-earned', 'true');
  await replace(page, []);
  await expect(page.locator('#badge-summary')).toHaveText('0/6 badges earned \u00b7 0/60 points');
  await expect(card(page, 'Trio').locator('.badge-state')).toHaveText('In progress');
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(tab(page, 'Badges')).toHaveAttribute('aria-selected', 'true');
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('passport:locations:v1')!) as LocationEntry[]);
  expect(data).toHaveLength(registry.length);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => /badge|tab/i.test(key)))).toEqual([]);
});

test('badges rank earned points first, then exact completion and points, retaining ties and card identities', async ({ page }) => {
  await ready(page, [
    ...catalog,
    { name: 'Half high', description: 'A high-value partial badge.', condition: 'SVK + CZE', value: 50 },
    { name: 'Half low', description: 'A lower-value partial badge.', condition: 'SVK + CZE', value: 3 },
    { name: 'Half twin', description: 'An exact tie retains catalog order.', condition: 'SVK + CZE', value: 50 },
    { name: 'Zero', description: 'Points cannot outrank progress or earned badges.', condition: 'DEU', value: 1000 },
  ]);
  await tab(page, 'Badges').click();
  const names = page.locator('.badge-card h4');
  await expect(names).toHaveText(['Pairs', 'Either', 'Additional', 'Trio', 'Half high', 'Half twin', 'Nested', 'Half low', 'Ten', 'Zero']);
  const original = await page.locator('.badge-list').evaluateHandle((list) => [...list.children]);
  await mapStatus(page, 'CZE', 'visited');
  await expect(names).toHaveText(['Half high', 'Half twin', 'Pairs', 'Trio', 'Nested', 'Either', 'Half low', 'Additional', 'Ten', 'Zero']);
  await replace(page, []);
  await expect(names).toHaveText(['Zero', 'Half high', 'Half twin', 'Ten', 'Pairs', 'Trio', 'Nested', 'Either', 'Half low', 'Additional']);
  expect(await original.evaluate((nodes) => nodes.every((node) => node.isConnected && node.parentElement?.className === 'badge-list'))).toBe(true);
  await original.dispose();
});

test('badge countries include all distinct formula references with live, theme-aware status colors', async ({ page }) => {
  await ready(page, [{
    name: 'Country list',
    description: 'All alternatives and threshold members count.',
    condition: '(SVK | CZE) + (AUT, DEU, SVK){2} + (custom:KOS + ATA)',
    value: 10,
  }]);
  await tab(page, 'Badges').click();
  const countries = card(page, 'Country list').locator('.badge-country');
  await expect(countries).toHaveCount(6);
  expect(await countries.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-country'))))
    .toEqual(['SVK', 'CZE', 'AUT', 'DEU', 'custom:KOS', 'ATA']);
  await expect(countries.locator('span:first-child')).toHaveText(
    ['SVK', 'CZE', 'AUT', 'DEU', 'custom:KOS', 'ATA'].map((id) => registry.find((country) => country.id === id)!.name),
  );
  const original = await countries.first().elementHandle();
  for (const theme of ['classic', 'dark', 'medieval']) {
    await tab(page, 'Countries').click();
    await page.locator('#theme-picker').selectOption(theme);
    await tab(page, 'Badges').click();
    for (const [id, status, label] of [
      ['SVK', 'visited', 'Visited'], ['CZE', 'unvisited', 'Unvisited'],
      ['AUT', 'lived', 'Lived / Living'], ['DEU', 'want_to_visit', 'Want to Visit'],
    ]) {
      const country = card(page, 'Country list').locator(`.badge-country[data-country="${id}"]`);
      await expect(country).toHaveAttribute('data-status', status!);
      await expect(country.locator('.sr-only')).toHaveText(`: ${label}`);
      await expect(country).toHaveAttribute('title', `${registry.find((entry) => entry.id === id)!.name}: ${label}`);
    }
    const colors = await countries.evaluateAll((nodes) => nodes.slice(0, 4).map((node) => getComputedStyle(node).color));
    expect(new Set(colors).size, `${theme}: four distinct status text colors`).toBe(4);
  }
  await mapStatus(page, 'DEU', 'visited');
  await expect(countries.nth(3)).toHaveAttribute('data-status', 'visited');
  expect(await countries.nth(3).evaluate((node) => getComputedStyle(node).color))
    .toBe(await countries.first().evaluate((node) => getComputedStyle(node).color));
  await replace(page, []);
  await expect(countries).toHaveCount(6);
  expect(await countries.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-status') === 'unvisited'))).toBe(true);
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
});

test('badge evaluation uses in-memory changes even when saving fails', async ({ page }) => {
  await ready(page);
  await tab(page, 'Badges').click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'passport:locations:v1') throw new DOMException('Full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await mapStatus(page, 'SVK', 'unvisited');
  await expect(page.locator('#badge-summary')).toHaveText('1/6 badges earned \u00b7 2/60 points');
  await expect(card(page, 'Either').locator('.badge-country[data-country="SVK"]')).toHaveAttribute('data-status', 'unvisited');
  await expect(page.locator('#save-status')).toContainText('Not saved');
  await tab(page, 'Stats').click();
  await expect(page.locator('[data-stat="visited"]')).toHaveText('3');
});

test('switching panels and updating badge cards preserves independent scroll positions', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 620 });
  await ready(page);
  await page.locator('.continent > summary').filter({ hasText: 'Europe' }).click();
  await page.locator('#country-groups').evaluate((node) => { node.scrollTop = 150; });
  await tab(page, 'Badges').click();
  await expect(page.locator('.badge-card')).toHaveCount(6);
  await page.locator('#panel-badges').evaluate((node) => { node.scrollTop = 250; });
  await tab(page, 'Stats').click();
  await page.locator('#panel-stats').evaluate((node) => { node.scrollTop = 100; });
  await tab(page, 'Countries').click();
  expect(await page.locator('#country-groups').evaluate((node) => node.scrollTop)).toBe(150);
  await expect(page.locator('.continent').filter({ has: page.locator('summary', { hasText: 'Europe' }) })).toHaveAttribute('open', '');
  await tab(page, 'Badges').click();
  expect(await page.locator('#panel-badges').evaluate((node) => node.scrollTop)).toBe(250);
  await mapStatus(page, 'CZE', 'visited');
  expect(await page.locator('#panel-badges').evaluate((node) => node.scrollTop)).toBe(250);
  await tab(page, 'Stats').click();
  expect(await page.locator('#panel-stats').evaluate((node) => node.scrollTop)).toBe(100);
  await mapStatus(page, 'CZE', 'unvisited');
  await tab(page, 'Badges').click();
  expect(await page.locator('#panel-badges').evaluate((node) => node.scrollTop)).toBe(250);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await mapStatus(page, 'CZE', 'visited');
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  expect(await page.locator('#panel-badges').evaluate((node) => node.scrollTop)).toBe(250);
});

test('empty catalog is honest and loaded once, without delaying the map', async ({ page }) => {
  await ready(page, []);
  let loads = 0;
  await page.route('**/data/badges.json', (route) => { loads++; return route.fulfill({ json: [] }); });
  expect(loads).toBe(0);
  await tab(page, 'Badges').click();
  await expect(page.locator('.badge-message')).toHaveText('No badges have been configured yet.');
  await expect(page.locator('.badge-card')).toHaveCount(0);
  await tab(page, 'Stats').click();
  await tab(page, 'Badges').click();
  expect(loads).toBe(1);
});

for (const failure of ['missing', 'json', 'formula', 'schema']) {
  test(`${failure} badge catalog errors stay isolated and retry can recover`, async ({ page }) => {
    await ready(page);
    await page.route('**/data/badges.json', (route) => failure === 'missing' ? route.fulfill({ status: 404, body: 'Missing' })
      : failure === 'json' ? route.fulfill({ contentType: 'application/json', body: '{oops' })
        : route.fulfill({ json: failure === 'formula' ? [{ ...catalog[0], condition: 'GER' }] : [{ ...catalog[0], value: -1 }] }));
    await tab(page, 'Badges').click();
    await expect(page.locator('.badge-message')).toContainText('Could not load badges.');
    if (failure === 'formula') await expect(page.locator('.badge-message')).toContainText('GER');
    await tab(page, 'Stats').click();
    await expect(page.locator('[data-stat="visited"]')).toHaveText('4');
    await tab(page, 'Countries').click();
    await expect(page.getByRole('searchbox')).toBeVisible();
    await tab(page, 'Badges').click();
    await page.route('**/data/badges.json', (route) => route.fulfill({ json: catalog }));
    await page.getByRole('button', { name: 'Retry loading badges' }).click();
    await expect(page.locator('.badge-card')).toHaveCount(6);
    await expect(page.locator('#panel-badges')).toBeFocused();
    await expect(page.locator('#badge-summary')).toContainText('22/60 points');
  });
}

test('a delayed badge load evaluates the newest store state and keeps focus on the current tab', async ({ page }) => {
  await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/data/badges.json', async (route) => { await gate; await route.fulfill({ json: catalog }); });
  await tab(page, 'Badges').click();
  await expect(page.locator('.badge-message')).toContainText('Loading');
  await mapStatus(page, 'CZE', 'visited');
  await tab(page, 'Stats').click();
  release();
  await expect(page.locator('#panel-badges')).toHaveAttribute('aria-busy', 'false');
  await expect(tab(page, 'Stats')).toBeFocused();
  await tab(page, 'Badges').click();
  await expect(page.locator('#badge-summary')).toContainText('40/60 points');
});

test('tab changes preserve Manage, map/scenery identities, selection and focus across hiding and mobile', async ({ page }) => {
  await ready(page);
  await page.getByRole('searchbox').fill('SVK');
  await page.getByRole('button', { name: 'Filter by Visited', exact: true }).click();
  const row = page.locator('.country-row[data-country="SVK"]');
  await row.click();
  await page.keyboard.press('Escape');
  const identity = await page.evaluateHandle(() => {
    const nodes = [...document.querySelectorAll('.country-boundary,.scenery-object,.country-row')];
    const geometry = [...document.querySelectorAll('.country-boundary')].map((node) => node.getAttribute('d'));
    const transform = document.querySelector('.land-layer')!.getAttribute('transform');
    return () => [...document.querySelectorAll('.country-boundary,.scenery-object,.country-row')].every((node, index) => node === nodes[index])
      && [...document.querySelectorAll('.country-boundary')].every((node, index) => node.getAttribute('d') === geometry[index])
      && document.querySelector('.land-layer')!.getAttribute('transform') === transform;
  });
  await tab(page, 'Badges').click();
  await expect(page.locator('.sidebar-country-preview')).toBeHidden();
  await expect(page.locator('.status-popover')).toBeHidden();
  await expect(page.locator('path[data-country="SVK"]')).toHaveClass(/is-selected/);
  await tab(page, 'Stats').click();
  await tab(page, 'Countries').click();
  expect(await identity.evaluate((read) => read())).toBe(true);
  await expect(page.getByRole('searchbox')).toHaveValue('SVK');
  await expect(page.getByRole('button', { name: 'Filter by Visited', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tab(page, 'Badges').click();
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await expect(tab(page, 'Badges')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#toggle-sidebar').focus();
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(tab(page, 'Badges')).toBeFocused();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await expect(tab(page, 'Badges')).toHaveAttribute('aria-selected', 'true');
  await identity.dispose();
});

test('long badge lists scroll internally without creating desktop page overflow in any theme', async ({ page }) => {
  await ready(page, Array.from({ length: 30 }, (_, index) => ({
    name: `Badge ${index + 1}`,
    description: 'An achievement with several contributing countries.',
    condition: '(SVK | CZE) + (AUT | DEU) + custom:KOS + ATA',
    value: index,
  })));
  for (const theme of ['classic', 'dark', 'medieval']) {
    await tab(page, 'Countries').click();
    await page.locator('#theme-picker').selectOption(theme);
    await tab(page, 'Badges').click();
    await expect(page.locator('.badge-card')).toHaveCount(30);
    for (const size of [{ width: 1280, height: 720 }, { width: 1000, height: 620 }]) {
      await page.setViewportSize(size);
      expect(await page.evaluate(() => document.documentElement.scrollHeight), `${theme}: document fits viewport`).toBe(size.height);
      const panel = page.locator('#panel-badges');
      expect(await panel.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await panel.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await expect(page.locator('.badge-card').last()).toBeInViewport();
      await expect(page.locator('#export-data')).toBeHidden();
      await expect(page.locator('.data-license')).toBeInViewport();
      await panel.hover();
      await page.mouse.wheel(0, 600);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(size.height);
    }
  }
});

for (const theme of ['classic', 'dark', 'medieval']) {
  test(`${theme} panels fit short desktop and narrow mobile with reachable Save/Export controls and credits`, async ({ page }) => {
    await ready(page, [{ ...catalog[0], name: '<script>not executable</script>'.repeat(3), description: 'A long description. '.repeat(30) }, ...catalog.slice(1)]);
    await page.locator('#theme-picker').selectOption(theme);
    for (const size of [{ width: 1000, height: 620 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size);
      for (const name of ['Countries', 'Stats', 'Badges', 'Save/Export']) {
        await tab(page, name).click();
        await expect(page.getByRole('tabpanel', { name })).toBeVisible();
        if (name === 'Countries') {
          expect((await page.locator('#country-groups').boundingBox())!.height).toBeGreaterThan(80);
        }
        for (const selector of ['#export-data', '#copy-data', '#import-data', '.data-license a']) {
          if (name !== 'Save/Export' && selector !== '.data-license a') {
            await expect(page.locator(selector)).toBeHidden();
            continue;
          }
          await page.locator(selector).first().scrollIntoViewIfNeeded();
          await expect(page.locator(selector).first()).toBeInViewport();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await expect(page.locator('.badge-card script')).toHaveCount(0);
  });
}
