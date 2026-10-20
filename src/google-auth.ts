export const GOOGLE_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive.appdata'] as const;

export interface GoogleAccount { sub: string; email?: string }
export interface GoogleAccess { account: GoogleAccount; token: string; expiresAt: number }
interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  token_type?: string;
  error?: string;
}
interface GoogleSdk {
  accounts: { oauth2: {
    initTokenClient(config: {
      client_id: string; scope: string;
      callback: (response: TokenResponse) => void;
      error_callback: (error: { type?: string }) => void;
    }): { requestAccessToken(config: { prompt: string }): void };
    hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
  } };
}
declare global { interface Window { google?: GoogleSdk } }

let loading: Promise<GoogleSdk> | undefined;
export function loadGoogleSdk(): Promise<GoogleSdk> {
  if (window.google?.accounts.oauth2) return Promise.resolve(window.google);
  if (loading) return loading;
  loading = new Promise<GoogleSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else if (window.google?.accounts.oauth2) resolve(window.google);
      else { script.remove(); reject(new Error('Google sign-in did not initialize. Please retry.')); }
    };
    const timer = setTimeout(() => finish(new Error('Google sign-in timed out. Check your connection and retry.')), 20000);
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Google sign-in could not load. Check your connection or content blocker.'));
    document.head.append(script);
  }).catch((error: unknown) => { loading = undefined; throw error; });
  return loading;
}

export class GoogleAuth {
  access: GoogleAccess | undefined;
  private sdk: GoogleSdk | undefined;
  private generation = 0;
  private cancelRequest: (() => void) | undefined;

  constructor(
    readonly clientId: string = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '',
    private request: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  get configured(): boolean { return /^[\w-]+\.apps\.googleusercontent\.com$/.test(this.clientId); }
  get valid(): boolean { return !!this.access && this.access.expiresAt > Date.now() + 30000; }

  async prepare(): Promise<void> {
    if (!this.configured) throw new Error('Google sync is not configured. Set VITE_GOOGLE_CLIENT_ID; local use is still available.');
    this.sdk = await loadGoogleSdk();
  }

  authorize(): Promise<GoogleAccess> {
    const sdk = this.sdk;
    if (!sdk) return Promise.reject(new Error('Load Google sign-in before connecting.'));
    this.disconnect();
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      const abort = new AbortController();
      let finished = false;
      const finish = (error?: Error, access?: GoogleAccess): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.cancelRequest = undefined;
        abort.abort();
        if (error) reject(error);
        else if (access) { this.access = access; resolve(access); }
      };
      this.cancelRequest = () => finish(new Error('Google connection cancelled.'));
      const timer = setTimeout(() => finish(new Error('Google connection timed out. Please retry.')), 120000);
      const config: Parameters<GoogleSdk['accounts']['oauth2']['initTokenClient']>[0] = {
        client_id: this.clientId,
        scope: GOOGLE_SCOPES.join(' '),
        callback: (response) => {
          if (finished || generation !== this.generation) return;
          void (async () => {
            if (response.error) throw new Error(`Google authorization failed: ${response.error}.`);
            if (!response.access_token || response.token_type?.toLowerCase() !== 'bearer'
              || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 30) {
              throw new Error('Google returned an invalid or expired access token.');
            }
            if (!sdk.accounts.oauth2.hasGrantedAllScopes(response, ...GOOGLE_SCOPES)) {
              throw new Error('Google Drive permission was not granted. Reconnect and allow private app-data access.');
            }
            const expiresAt = Date.now() + Number(response.expires_in) * 1000;
            const user = await this.request('https://openidconnect.googleapis.com/v1/userinfo', {
              headers: { Authorization: `Bearer ${response.access_token}` }, signal: abort.signal,
            });
            if (!user.ok) throw new Error(`Google account verification failed (${user.status}). Reconnect to retry.`);
            const value: unknown = await user.json();
            if (!value || typeof value !== 'object' || !('sub' in value)
              || typeof value.sub !== 'string' || !/^[\w-]{1,255}$/.test(value.sub)) {
              throw new Error('Google returned an invalid account identity.');
            }
            const account: GoogleAccount = { sub: value.sub };
            if ('email' in value && typeof value.email === 'string') account.email = value.email;
            if (generation === this.generation && !finished) finish(undefined, { account, token: response.access_token, expiresAt });
          })().catch((error: unknown) => finish(error instanceof Error ? error : new Error('Google account verification failed.')));
        },
        error_callback: (error) => finish(new Error(error.type === 'popup_closed'
          ? 'Google connection cancelled.' : error.type === 'popup_failed_to_open'
            ? 'Google popup was blocked. Allow popups and try again.' : 'Google sign-in failed. Please retry.')),
      };
      try { sdk.accounts.oauth2.initTokenClient(config).requestAccessToken({ prompt: 'select_account' }); }
      catch (error) { finish(error instanceof Error ? error : new Error('Google sign-in could not start.')); }
    });
  }

  disconnect(): void {
    this.generation++;
    this.access = undefined;
    this.cancelRequest?.();
    this.cancelRequest = undefined;
  }
}
