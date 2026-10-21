import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };
import { CONTINENTS, type Continent, type LocationEntry, type TravelStatus } from '../../src/types';

const pageErrors = new WeakMap<Page, string[]>();
const mixedStatuses: Record<string, TravelStatus> = {
  EST: 'visited', FRA: 'lived', DEU: 'want_to_visit', AUS: 'visited',
  'custom:KOS': 'visited', 'custom:SOL': 'lived',
};
const mixedEntries: LocationEntry[] = registry.filter((country) => mixedStatuses[country.id])
  .map(({ id, name, continent }) => ({ id, name, continent, status: mixedStatuses[id]! }));
const isoTotal = (continent: Continent) => registry.filter((country) => country.kind === 'iso' && country.continent === continent).length;

function summary(page: Page, continent: string) {
  return page.locator('.continent summary').filter({ has: page.getByText(continent, { exact: true }) });
}

function counter(page: Page, continent: Continent) {
  return summary(page, continent).locator('.continent-count');
}

async function ready(page: Page, entries: LocationEntry[] = []): Promise<void> {
  await page.addInitScript((data) => {
    if (localStorage.getItem('passport:locations:v1') === null) {
      localStorage.setItem('passport:locations:v1', JSON.stringify(data));
    }
  }, entries);
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}

async function setStatus(page: Page, id: string, status: TravelStatus): Promise<void> {
  const row = page.locator(`.country-row[data-country="${id}"]`);
  const group = row.locator('..');
  if (await group.getAttribute('open') === null) await group.locator('summary').click();
  await row.click();
  await page.locator(`.status-choice[data-status="${status}"]`).click();
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

test('shows full ISO progress separately from combined global totals', async ({ page }) => {
  await ready(page, mixedEntries);
  for (const continent of [...CONTINENTS, 'Antarctica'] as const) {
    const completed = continent === 'Europe' ? 2 : continent === 'Oceania' ? 1 : 0;
    await expect(counter(page, continent)).toHaveText(`(${completed}/${isoTotal(continent)})`);
    await expect(summary(page, continent)).toHaveAccessibleDescription(
      `${completed} of ${isoTotal(continent)} official ISO countries and territories visited or lived in`,
    );
  }
  await expect(page.locator('#visited-count')).toHaveText('3');
  await expect(page.locator('#lived-count')).toHaveText('2');
  await expect(page.locator('#colored-count')).toHaveText(`6 / ${registry.length}`);
});

test('updates statuses in place without losing focus or accordion state and restores on reload', async ({ page }) => {
  await ready(page);
  const europe = summary(page, 'Europe');
  await europe.click();
  const africa = summary(page, 'Africa').locator('..');
  const row = page.locator('.country-row[data-country="EST"]');
  const originalRow = await row.elementHandle();
  const originalSummary = await europe.elementHandle();
  for (const [status, completed] of [
    ['visited', 1], ['lived', 1], ['want_to_visit', 0], ['unvisited', 0], ['visited', 1],
  ] as const) {
    await row.click();
    const scroll = await page.locator('#country-groups').evaluate((element) => element.scrollTop);
    await page.locator(`.status-choice[data-status="${status}"]`).click();
    await expect(counter(page, 'Europe')).toHaveText(`(${completed}/${isoTotal('Europe')})`);
    await expect(row).toBeFocused();
    await expect(africa).not.toHaveAttribute('open');
    expect(await originalRow!.evaluate((element) => element === document.querySelector('.country-row[data-country="EST"]'))).toBe(true);
    expect(await originalSummary!.evaluate((element) => element.isConnected)).toBe(true);
    expect(await page.locator('#country-groups').evaluate((element) => element.scrollTop)).toBe(scroll);
  }
  await page.reload();
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
});

test('search and custom-only results keep full progress, including hidden ISO places', async ({ page }) => {
  await ready(page, mixedEntries);
  const search = page.getByRole('searchbox');
  await search.fill('France');
  await expect(page.locator('.country-row')).toHaveCount(1);
  await expect(counter(page, 'Europe')).toHaveText(`(2/${isoTotal('Europe')})`);
  await setStatus(page, 'FRA', 'unvisited');
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
  await search.fill('custom:KOS');
  await expect(page.locator('.country-row')).toHaveCount(1);
  await setStatus(page, 'custom:KOS', 'lived');
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
  await search.fill('Kenya');
  await expect(summary(page, 'Africa').locator('..')).toHaveAttribute('open');
  await setStatus(page, 'KEN', 'visited');
  await expect(counter(page, 'Africa')).toHaveText(`(1/${isoTotal('Africa')})`);
  await search.fill('nothing-matches');
  await expect(page.locator('.empty-state')).toBeVisible();
  await search.clear();
  await expect(summary(page, 'Africa').locator('..')).not.toHaveAttribute('open');
  await expect(counter(page, 'Africa')).toHaveText(`(1/${isoTotal('Africa')})`);
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
});

test('confirmed imports update filtered counts, ignore subdivisions, and survive reload', async ({ page }) => {
  await ready(page, mixedEntries);
  const search = page.getByRole('searchbox');
  await search.fill('Estonia');
  await page.locator('#import-file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('[]') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(counter(page, 'Europe')).toHaveText(`(2/${isoTotal('Europe')})`);
  const imported = [
    { id: 'FRA', name: 'France', continent: 'Europe', status: 'lived' },
    { id: 'ATA', name: 'Antarctica', continent: 'Antarctica', status: 'visited' },
    { id: 'custom:KOS', name: 'Kosovo', continent: 'Europe', status: 'visited' },
    {
      id: 'USA', name: 'United States', continent: 'North America', status: 'unvisited',
      subdivisions: [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'lived' }],
    },
  ];
  await page.locator('#import-file').setInputFiles({
    name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page.getByRole('button', { name: 'Replace data', exact: true }).click();
  await expect(search).toHaveValue('Estonia');
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
  await expect(page.locator('.country-row[data-country="EST"]')).toHaveAttribute('data-status', 'unvisited');
  await search.clear();
  await expect(counter(page, 'North America')).toHaveText(`(0/${isoTotal('North America')})`);
  await expect(counter(page, 'Antarctica')).toHaveText('(1/1)');
  await page.reload();
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
  await expect(counter(page, 'North America')).toHaveText(`(0/${isoTotal('North America')})`);
  await expect(counter(page, 'Antarctica')).toHaveText('(1/1)');
});

test('Antarctica has its own live accessible progress through every status', async ({ page }) => {
  await ready(page);
  await page.getByRole('searchbox').fill('ATA');
  const row = page.locator('.country-row[data-country="ATA"]');
  for (const [status, completed] of [
    ['visited', 1], ['lived', 1], ['want_to_visit', 0], ['unvisited', 0],
  ] as const) {
    await setStatus(page, 'ATA', status);
    await expect(counter(page, 'Antarctica')).toHaveText(`(${completed}/1)`);
    await expect(summary(page, 'Antarctica')).toHaveAccessibleDescription(
      `${completed} of 1 official ISO countries and territories visited or lived in`,
    );
    await expect(row).toBeFocused();
  }
  await page.getByRole('searchbox').clear();
  await expect(page.locator('.continent')).toHaveCount(CONTINENTS.length + 1);
});

test('in-memory progress stays accurate when storage cannot save', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await setStatus(page, 'EST', 'visited');
  await expect(counter(page, 'Europe')).toHaveText(`(1/${isoTotal('Europe')})`);
  await expect(page.locator('#warning')).toBeVisible();
  await expect(page.locator('#visited-count')).toHaveText('1');
});

test('progress fits desktop and narrow mobile layouts in every skin', async ({ page }) => {
  await ready(page, mixedEntries);
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ['classic', 'dark', 'medieval']) {
      await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
      await expect(counter(page, 'Europe')).toHaveText(`(2/${isoTotal('Europe')})`);
      await expect(counter(page, 'Oceania')).toHaveText(`(1/${isoTotal('Oceania')})`);
      const fit = await page.locator('.continent-count').evaluateAll((elements) => elements.every((element) => {
        const bounds = element.getBoundingClientRect();
        const label = element.closest('summary, .country-row')!.getBoundingClientRect();
        return bounds.width > 0 && bounds.left >= label.left && bounds.right <= label.right
          && bounds.right <= document.documentElement.clientWidth;
      }));
      expect(fit).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});
