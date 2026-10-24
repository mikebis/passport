import { isLocalAddress } from './address';

interface PrivacySignals {
  doNotTrack?: string | null;
  msDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}
interface AnalyticsEnvironment {
  production: boolean;
  measurementId: string;
  address: string;
  base: string;
  referrer: string;
  navigator: PrivacySignals;
  windowDoNotTrack?: string | null;
}
interface PageParameters {
  page_title: string;
  page_location: string;
  page_referrer: string;
}
type AnalyticsCommand =
  | ['js', Date]
  | ['set', PageParameters]
  | ['config', string, { send_page_view: false; allow_google_signals: false; allow_ad_personalization_signals: false } & PageParameters]
  | ['event', 'page_view', PageParameters];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...command: AnalyticsCommand) => void;
    doNotTrack?: string | null;
  }
}

export function analyticsConfiguration(environment: AnalyticsEnvironment): { id: string; page: PageParameters } | undefined {
  const id = environment.measurementId.trim();
  if (!id) return;
  if (!/^G-[A-Z0-9]+$/.test(id)) throw new Error('Google Analytics measurement ID must start with G- and contain only uppercase letters and digits.');
  const url = new URL(environment.address);
  const signals = environment.navigator;
  const optedOut = signals.globalPrivacyControl === true
    || [signals.doNotTrack, signals.msDoNotTrack, environment.windowDoNotTrack].some(value => value === '1' || value === 'yes');
  if (!environment.production || optedOut || !['http:', 'https:'].includes(url.protocol) || isLocalAddress(url.href)) return;
  if (!environment.base.startsWith('/') || environment.base.startsWith('//')) throw new Error('Google Analytics requires an absolute application base path.');
  const page = new URL(environment.base, url.origin);
  if (page.origin !== url.origin) throw new Error('Google Analytics requires a same-origin application base path.');
  page.search = '';
  page.hash = '';
  let referrer = '';
  if (environment.referrer) {
    try {
      const source = new URL(environment.referrer);
      if (['http:', 'https:'].includes(source.protocol)) referrer = source.origin;
    } catch {
      // A malformed document referrer is not usable traffic metadata.
    }
  }
  return { id, page: { page_title: 'passport', page_location: page.href, page_referrer: referrer } };
}

let started = false;

export function initializeAnalytics(): void {
  if (started) return;
  let configuration: ReturnType<typeof analyticsConfiguration>;
  try {
    configuration = analyticsConfiguration({
      production: import.meta.env.PROD,
      measurementId: import.meta.env.VITE_GOOGLE_ANALYTICS_ID ?? '',
      address: window.location.href,
      base: import.meta.env.BASE_URL,
      referrer: document.referrer,
      navigator,
      windowDoNotTrack: window.doNotTrack,
    });
  } catch {
    console.warn('Google Analytics is disabled: invalid measurement ID or page configuration.');
    return;
  }
  if (!configuration) return;
  started = true;
  const { id, page } = configuration;
  const dataLayer = window.dataLayer ??= [];
  // eslint-disable-next-line prefer-rest-params -- gtag.js expects command Arguments objects, not data-layer event arrays.
  window.gtag = function (..._command: AnalyticsCommand): void { dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('set', page);
  window.gtag('config', id, {
    ...page, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
  });
  window.gtag('event', 'page_view', page);

  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'origin';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  const finish = (failed: boolean): void => {
    clearTimeout(timer);
    script.onload = null;
    script.onerror = null;
    if (failed) {
      script.remove();
      console.warn('Google Analytics could not load. Local map features remain available.');
    }
  };
  const timer = setTimeout(() => finish(true), 15000);
  script.onload = () => finish(false);
  script.onerror = () => finish(true);
  document.head.append(script);
}
