/**
 * Google Analytics (gtag.js), loaded only after the visitor accepts analytics cookies.
 *
 * - Nothing is requested from Google until consent is 'granted'; declining (or ignoring the banner) means no
 *   script, no cookies, no pings.
 * - Ad-related consent signals are always denied: this is usage measurement only.
 * - Events carry settings and counts, never file names or image data (photos never leave the browser).
 * - Only production builds talk to Google, so dev servers and e2e runs don't pollute the property.
 */

export const GA_MEASUREMENT_ID = (import.meta.env.VITE_GA_ID as string | undefined) ?? 'G-DN1VQKFW2X';
const ENABLED = import.meta.env.PROD && GA_MEASUREMENT_ID !== '';

export type Consent = 'granted' | 'denied';
export const CONSENT_KEY = 'montage.analyticsConsent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

let consent: Consent | null = readConsent();
let loaded = false;
const listeners = new Set<() => void>();

export function getConsent(): Consent | null {
  return consent;
}

export function subscribeConsent(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load(): void {
  if (loaded || !ENABLED) return;
  loaded = true;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js only recognises the `arguments` object itself, not a copied array.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.appendChild(s);
}

/** Remove GA's first-party cookies (_ga, _ga_<id>) for this host and its parent domains. */
function clearGaCookies(): void {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim() ?? '')
    .filter((n) => n === '_ga' || n.startsWith('_ga_'));
  const parts = location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
  for (const n of names) {
    for (const d of domains) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
  }
}

export function setConsent(next: Consent): void {
  consent = next;
  try {
    localStorage.setItem(CONSENT_KEY, next);
  } catch {
    // Storage unavailable: the choice holds for this page load only.
  }
  const disableKey = `ga-disable-${GA_MEASUREMENT_ID}`;
  if (next === 'granted') {
    (window as unknown as Record<string, unknown>)[disableKey] = false;
    if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    else load();
  } else {
    (window as unknown as Record<string, unknown>)[disableKey] = true;
    window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
    clearGaCookies();
  }
  for (const fn of listeners) fn();
}

/** Start analytics on page load if the visitor accepted on an earlier visit. */
export function initAnalytics(): void {
  if (consent === 'granted') load();
}

/** Send a GA event. A no-op until analytics has consent and has loaded. */
export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  if (consent !== 'granted' || !loaded) return;
  window.gtag?.('event', event, params);
}
