import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import registry from '../../data/registry.json' with { type: 'json' };

const config = JSON.parse(readFileSync(new URL('../../public/staticwebapp.config.json', import.meta.url), 'utf8')) as { globalHeaders: Record<string, string> };
const headers = config.globalHeaders;

/** Serves every document with the production security headers and records CSP violations. */
async function withProductionHeaders(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction('__reportCspViolation', (detail: string) => { violations.push(detail); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void Reflect.get(window, '__reportCspViolation')(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...headers } });
  });
  return violations;
}

test('production headers include a restrictive content security policy', () => {
  const csp = headers['Content-Security-Policy']!;
  for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) expect(csp).toContain(directive);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  expect(headers['X-Content-Type-Options']).toBe('nosniff');
  expect(headers['X-Frame-Options']).toBe('DENY');
});

test('the application, themes and picture generator work under the production CSP', async ({ page }) => {
  test.skip(!process.env.TEST_PRODUCTION, 'Vite development hosting injects inline scripts; check the production build.');
  const violations = await withProductionHeaders(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
  for (const theme of ['dark', 'medieval', 'classic']) await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
  await page.getByRole('tab', { name: 'Badges' }).click();
  await page.getByRole('tab', { name: 'Save/Export', exact: true }).click();
  await page.getByRole('button', { name: 'Share picture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your travel passport', exact: true });
  await expect(dialog.getByRole('button', { name: 'Download PNG', exact: true })).toBeEnabled({ timeout: 20000 });
  await expect(dialog.locator('.infographic-preview img')).toHaveJSProperty('complete', true);
  expect(await dialog.locator('.infographic-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2400);
  expect(violations).toEqual([]);
});

test('the Google connection flow is permitted by the production CSP', async ({ page }) => {
  test.skip(!process.env.TEST_PRODUCTION, 'Vite development hosting injects inline scripts; check the production build.');
  const violations = await withProductionHeaders(page);
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.google = { accounts: { oauth2: {
      initTokenClient(config) { return { requestAccessToken() {
        queueMicrotask(() => config.callback({ access_token: 'csp-test-token', expires_in: 3600, token_type: 'Bearer' }));
      } }; },
      hasGrantedAllScopes() { return true; }
    } } };
  ` }));
  await page.route('https://openidconnect.googleapis.com/v1/userinfo', (route) => route.fulfill({ json: { sub: 'csp-account', email: 'csp@example.test' } }));
  await page.route(/https:\/\/www\.googleapis\.com\/drive\/v3\/files/, (route) => route.fulfill({ json: { files: [], incompleteSearch: false } }));
  await page.goto('./');
  await expect(page.locator('.country-boundary')).toHaveCount(registry.length);
  await page.getByRole('tab', { name: 'Save/Export', exact: true }).click();
  const connect = page.getByRole('button', { name: 'Connect Google Drive', exact: true });
  test.skip(await connect.isDisabled(), 'Configured build required for mocked Google provider scenarios.');
  await connect.click();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back up this device to Google Drive', exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});
