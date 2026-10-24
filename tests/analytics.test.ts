import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsConfiguration } from '../src/analytics';
import { isLocalAddress } from '../src/address';

const environment = {
  production: true, measurementId: 'G-0000000000', address: 'https://passport.example.test/?name=secret#token',
  base: '/', referrer: 'https://referrer.example.test/private?email=secret#name', navigator: {},
};

describe('basic analytics policy', () => {
  it('uses only safe fixed page metadata and a referrer origin', () => {
    expect(analyticsConfiguration(environment)).toEqual({
      id: 'G-0000000000', page: { page_title: 'passport', page_location: 'https://passport.example.test/', page_referrer: 'https://referrer.example.test' },
    });
  });
});

describe('analytics script lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function setup(id = 'G-0000000000') {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_GOOGLE_ANALYTICS_ID', id);
    vi.stubEnv('BASE_URL', '/passport/');
    const script: {
      async?: boolean; referrerPolicy?: string; src?: string;
      onload?: (() => void) | null; onerror?: (() => void) | null; remove: ReturnType<typeof vi.fn>;
    } = { remove: vi.fn() };
    const append = vi.fn();
    const browser: { location: { href: string }; dataLayer?: IArguments[] } = {
      location: { href: environment.address },
    };
    vi.stubGlobal('window', browser);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { referrer: environment.referrer, createElement: () => script, head: { append } });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initializeAnalytics } = await import('../src/analytics');
    return { initializeAnalytics, script, append, warning, browser };
  }

  it('queues official Arguments commands and injects only one asynchronous tag', async () => {
    const { initializeAnalytics, script, append, browser, warning } = await setup();
    initializeAnalytics();
    initializeAnalytics();
    expect(append).toHaveBeenCalledExactlyOnceWith(script);
    expect(script.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-0000000000');
    expect(script.async).toBe(true);
    expect(script.referrerPolicy).toBe('origin');
    expect(browser.dataLayer?.map(command => Array.from(command)[0])).toEqual(['js', 'set', 'config', 'event']);
    expect(browser.dataLayer?.every(command => !Array.isArray(command))).toBe(true);
    script.onload?.();
    await vi.runAllTimersAsync();
    expect(warning).not.toHaveBeenCalled();
    expect(script.remove).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'timeout'])('reports script %s once and cleans up without retrying', async (failure) => {
    const { initializeAnalytics, script, append, warning } = await setup();
    initializeAnalytics();
    if (failure === 'error') script.onerror?.();
    await vi.runAllTimersAsync();
    initializeAnalytics();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Google Analytics could not load. Local map features remain available.');
    expect(script.remove).toHaveBeenCalledOnce();
    expect(script.onload).toBeNull();
    expect(script.onerror).toBeNull();
    expect(append).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid configuration explicitly without creating globals or scripts', async () => {
    const { initializeAnalytics, append, warning, browser } = await setup('G-INVALID?secret');
    initializeAnalytics();
    expect(append).not.toHaveBeenCalled();
    expect(browser.dataLayer).toBeUndefined();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Google Analytics is disabled: invalid measurement ID or page configuration.');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('analytics address and exclusion policy', () => {
  it('removes credentials and incidental paths from page metadata', () => {
    expect(analyticsConfiguration({ ...environment, address: 'https://user:password@passport.example.test/private/path?q=secret', base: '/passport/' })?.page.page_location)
      .toBe('https://passport.example.test/passport/');
  });

  it.each(['', 'invalid', 'data:text/plain,secret', 'file:///private'])('drops unusable referrer %s', (referrer) => {
    expect(analyticsConfiguration({ ...environment, referrer })?.page.page_referrer).toBe('');
  });

  it('does nothing without configuration or in development', () => {
    expect(analyticsConfiguration({ ...environment, measurementId: '  ' })).toBeUndefined();
    expect(analyticsConfiguration({ ...environment, production: false })).toBeUndefined();
    expect(analyticsConfiguration({ ...environment, address: 'file:///app.html' })).toBeUndefined();
  });

  it.each(['GTM-ABC', 'UA-123-1', 'G-abc', 'G-', 'G-ABC?token=secret', '<script>'])('rejects malformed ID %s', (measurementId) => {
    expect(() => analyticsConfiguration({ ...environment, measurementId })).toThrow('measurement ID');
  });

  it.each([
    { doNotTrack: '1' }, { doNotTrack: 'yes' }, { msDoNotTrack: '1' }, { globalPrivacyControl: true },
  ])('honors affirmative privacy signals %j', (navigator) => {
    expect(analyticsConfiguration({ ...environment, navigator })).toBeUndefined();
  });

  it('honors legacy window DNT and accepts negative/unspecified signals', () => {
    expect(analyticsConfiguration({ ...environment, windowDoNotTrack: '1' })).toBeUndefined();
    expect(analyticsConfiguration({ ...environment, navigator: { doNotTrack: '0', globalPrivacyControl: false } })).toBeDefined();
  });

  it('rejects nonlocal or ambiguous base paths', () => {
    for (const base of ['//other.example.test/', 'relative', '/\\other.example.test/']) {
      expect(() => analyticsConfiguration({ ...environment, base })).toThrow('base path');
    }
    expect(analyticsConfiguration({ ...environment, base: '/passport/?private#secret' })?.page.page_location)
      .toBe('https://passport.example.test/passport/');
  });

  it.each([
    'localhost', 'LOCALHOST.', 'app.localhost', 'computer', 'app.local', '127.0.0.1', '127.9.0.1', '0.0.0.0', '10.2.3.4',
    '172.16.1.1', '172.31.1.1', '192.168.1.1', '169.254.1.1', '100.64.1.1', '100.127.1.1',
    '[::1]', '[::]', '[fc00::1]', '[fd12::1]', '[fe80::1]', '[::ffff:192.168.1.1]', '[::ffff:127.0.0.1]',
  ])('excludes local/private address %s', (host) => {
    const address = `http://${host}/`;
    expect(isLocalAddress(address)).toBe(true);
    expect(analyticsConfiguration({ ...environment, address })).toBeUndefined();
  });

  it.each(['passport.example.test', '172.15.1.1', '172.32.1.1', '192.169.1.1', '100.128.1.1', '[2001:4860::1]'])('allows public host %s', (host) => {
    expect(isLocalAddress(`https://${host}/`)).toBe(false);
  });
});
