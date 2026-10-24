import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };

const mode = process.env.TEST_ANALYTICS_MODE;
const production = !!process.env.TEST_PRODUCTION;
const base = process.env.TEST_BASE_PATH || '/';
const publicOrigin = 'https://passport.example.test';
const config = JSON.parse(readFileSync(new URL('../../public/staticwebapp.config.json', import.meta.url), 'utf8')) as { globalHeaders: Record<string, string> };
const primaryEndpoint = 'https://www.google-analytics.com/g/collect';

async function mockSite(page: Page, options: { endpoint?: string; blocked?: boolean; delayed?: boolean; origin?: string } = {}) {
  const requests: string[] = [];
  const payloads: string[] = [];
  const violations: string[] = [];
  await page.exposeFunction('__analyticsCsp', (detail: string) => { violations.push(detail); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void Reflect.get(window, '__analyticsCsp')(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === (options.origin || publicOrigin)) {
      const response = await route.fetch({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` });
      return route.fulfill({ response, headers: {
        ...response.headers(),
        ...(production && request.resourceType() === 'document' ? config.globalHeaders : {}),
      } });
    }
    if (url.hostname === '127.0.0.1') return route.continue();
    requests.push(request.url());
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      if (options.blocked) return route.abort();
      if (options.delayed) {
        // An indefinitely pending script: the test advances the app's bounded timeout.
        return;
      }
      return route.fulfill({ contentType: 'application/javascript', body: `
        const commands = window.dataLayer.map(command => Array.from(command));
        const configuration = commands.find(command => command[0] === 'config');
        const event = commands.find(command => command[0] === 'event' && command[1] === 'page_view');
        if (configuration && event) {
          fetch(${JSON.stringify(options.endpoint || primaryEndpoint)}, {
            method: 'POST',
            body: new URLSearchParams({tid: configuration[1], en: event[1], ...event[2]})
          });
        }
      ` });
    }
    if (url.hostname.endsWith('.google-analytics.com') || url.hostname.endsWith('.analytics.google.com')) {
      payloads.push(request.postData() || url.search);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.abort();
  });
  return { requests, payloads, violations };
}

async function ready(page: Page, query = '', origin = publicOrigin): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${origin}${base}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
}

async function commands(page: Page): Promise<unknown[][]> {
  return page.evaluate(() => window.dataLayer?.map(command => Array.from(command as IArguments)) ?? []);
}

test.describe('configured production analytics', () => {
  test.skip(mode !== 'configured' || !production, 'Requires the isolated synthetic analytics production build.');

  for (const endpoint of [primaryEndpoint, 'https://region1.google-analytics.com/g/collect', 'https://region1.analytics.google.com/g/collect']) {
    test(`one safe page view is permitted by CSP at ${new URL(endpoint).hostname}`, async ({ page }) => {
      const mock = await mockSite(page, { endpoint });
      await page.addInitScript(() => {
        Object.defineProperty(document, 'referrer', { value: 'https://source.example.test/private?email=private@example.test#secret' });
      });
      await ready(page, '?name=PrivateName&access_token=PrivateToken#PrivateFragment');
      await expect.poll(() => mock.payloads.length).toBe(1);
      const queue = await commands(page);
      expect(queue.map(command => command[0])).toEqual(['js', 'set', 'config', 'event']);
      expect(queue[2]).toEqual(['config', 'G-0000000000', {
        page_title: 'passport', page_location: `${publicOrigin}${base}`, page_referrer: 'https://source.example.test',
        send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      }]);
      expect(queue[3]).toEqual(['event', 'page_view', {
        page_title: 'passport', page_location: `${publicOrigin}${base}`, page_referrer: 'https://source.example.test',
      }]);
      expect(mock.requests.filter(url => url.includes('/gtag/js'))).toHaveLength(1);
      const payload = new URLSearchParams(mock.payloads[0]);
      expect(payload.get('page_location')).toBe(`${publicOrigin}${base}`);
      expect(payload.get('page_referrer')).toBe('https://source.example.test');
      expect(JSON.stringify(queue) + mock.payloads.join('')).not.toMatch(/PrivateName|PrivateToken|PrivateFragment|private@example|access_token|user_id|user_properties/);
      expect(mock.violations).toEqual([]);
    });
  }

  test('editing, preferences, tabs, export and picture names never create analytics commands', async ({ page }) => {
    const mock = await mockSite(page);
    await ready(page);
    await expect.poll(() => mock.payloads.length).toBe(1);
    const initial = await commands(page);
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
    await page.getByRole('combobox', { name: 'Projection', exact: true }).selectOption('mercator');
    await page.locator('.continent').first().locator('summary').click();
    const row = page.locator('.country-row:visible').first();
    await row.click();
    await page.getByRole('button', { name: 'Visited', exact: true }).click();
    await page.getByRole('tab', { name: 'Stats', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('tab', { name: 'Save/Export', exact: true }).click();
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('passport-data.json');
    await page.getByRole('tab', { name: 'Save/Export', exact: true }).click();
    await page.getByRole('button', { name: 'Share picture', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Your travel passport', exact: true });
    await dialog.getByLabel('Name (optional)', { exact: true }).fill('PrivatePictureName');
    await expect(dialog.getByRole('button', { name: 'Download PNG', exact: true })).toBeEnabled({ timeout: 20000 });
    expect(await commands(page)).toEqual(initial);
    expect(mock.payloads).toHaveLength(1);
    expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('analytics');
    expect(mock.violations).toEqual([]);
  });

  for (const signal of ['dnt', 'legacy-dnt', 'ms-dnt', 'gpc']) {
    test(`skips all analytics when ${signal} is enabled`, async ({ page }) => {
      const mock = await mockSite(page);
      await page.addInitScript((signal) => {
        if (signal === 'legacy-dnt') Object.defineProperty(window, 'doNotTrack', { value: '1' });
        else Object.defineProperty(navigator, signal === 'gpc' ? 'globalPrivacyControl' : signal === 'ms-dnt' ? 'msDoNotTrack' : 'doNotTrack', {
          value: signal === 'gpc' ? true : '1',
        });
      }, signal);
      await ready(page);
      expect(mock.requests).toEqual([]);
      expect(await page.evaluate(() => ({ queue: window.dataLayer, tag: typeof window.gtag, cookies: document.cookie })))
        .toEqual({ queue: undefined, tag: 'undefined', cookies: '' });
      expect(mock.violations).toEqual([]);
    });
  }

  for (const failure of ['blocked', 'timeout']) {
    test(`script ${failure} warns without breaking the map`, async ({ page }) => {
      const warnings: string[] = [];
      page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
      if (failure === 'timeout') await page.clock.install();
      const mock = await mockSite(page, { blocked: failure === 'blocked', delayed: failure === 'timeout' });
      await ready(page);
      if (failure === 'timeout') await page.clock.runFor(15001);
      await expect.poll(() => warnings.filter(message => message.includes('Google Analytics could not load.')).length).toBe(1);
      expect(mock.payloads).toEqual([]);
      await page.getByRole('tab', { name: 'Save/Export', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Export data', exact: true })).toBeEnabled();
      await expect(page.locator('#warning')).toBeHidden();
      await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
    });
  }

  for (const host of ['192.168.1.2', '10.1.2.3', '[::1]', '[fd12::1]', 'preview.local']) {
    test(`private preview ${host} remains analytics-free`, async ({ page }) => {
      const origin = `https://${host}`;
      const mock = await mockSite(page, { origin });
      await ready(page, '', origin);
      expect(mock.requests).toEqual([]);
      expect(await commands(page)).toEqual([]);
      expect(mock.violations).toEqual([]);
    });
  }

  test('initialization is idempotent and CSP still rejects unrelated connections', async ({ page }) => {
    const mock = await mockSite(page);
    await ready(page);
    await expect.poll(() => mock.payloads.length).toBe(1);
    await page.getByRole('tab', { name: 'Stats', exact: true }).click();
    await page.getByRole('tab', { name: 'Countries', exact: true }).click();
    expect(await commands(page)).toHaveLength(4);
    expect(await page.evaluate(() => fetch('https://unrelated.example.test/collect').then(() => true, () => false))).toBe(false);
    await expect.poll(() => mock.violations.some(value => value.includes('connect-src') && value.includes('unrelated.example.test'))).toBe(true);
  });
});

test.describe('disabled analytics builds', () => {
  test.skip(!['unconfigured', 'development', 'invalid'].includes(mode || ''), 'Requires an explicit disabled-configuration validation build.');

  test('public-origin application never loads a tag or creates identifiers', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    const mock = await mockSite(page);
    await ready(page);
    expect(mock.requests).toEqual([]);
    expect(await commands(page)).toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(warnings.filter(value => value.includes('Google Analytics is disabled:'))).toHaveLength(mode === 'invalid' ? 1 : 0);
  });
});

test('localhost preview remains analytics-free even when configured', async ({ page }) => {
  const mock = await mockSite(page);
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
  expect(mock.requests).toEqual([]);
  expect(await commands(page)).toEqual([]);
});

test('Privacy link is shared, keyboard accessible and readable in every theme and layout', async ({ page, context }) => {
  const mock = await mockSite(page);
  await ready(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 620 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['classic', 'dark', 'medieval']) {
      await page.getByRole('tab', { name: 'Countries', exact: true }).click();
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
      for (const tab of ['Countries', 'Stats', 'Badges', 'Save/Export']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        const link = page.locator('.sidebar-footer').getByRole('link', { name: 'Privacy', exact: true });
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport();
        await expect(link).toHaveAttribute('href', `${base}privacy.html`);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener');
        await page.getByRole('link', { name: 'View on GitHub', exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
  // The new document must not run the app's analytics even in a configured build.
  const privacy = await context.newPage();
  const privacyMock = await mockSite(privacy);
  await privacy.goto(`${publicOrigin}${base}privacy.html`);
  await expect(privacy.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await expect(privacy.getByRole('heading', { name: 'Optional Google Analytics', exact: true })).toBeVisible();
  await expect(privacy.locator('body')).toContainText('Do Not Track or Global Privacy Control');
  await expect(privacy.locator('script')).toHaveCount(0);
  expect(privacyMock.requests).toEqual([]);
  expect(privacyMock.violations).toEqual([]);
  await expect(privacy.getByRole('link', { name: 'Return to passport', exact: true })).toHaveAttribute('href', './');
  expect(mock.violations).toEqual([]);
});
