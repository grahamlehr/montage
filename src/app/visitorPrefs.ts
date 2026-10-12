import { useSyncExternalStore } from 'react';
import { getConsent, subscribeConsent } from './analytics';
import { currentBrowserInfo, isSupportedBrowser } from './browserSupport';

/** Per-visitor UI state kept in browser storage: consent, tour and browser-notice dismissals. */

export function useConsent() {
  return useSyncExternalStore(subscribeConsent, getConsent);
}

const DISMISSED_KEY = 'montage.browserNoticeDismissed';

export function browserNoticeDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markBrowserNoticeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable (private mode etc.): the notice just shows again next load.
  }
}

/** True when this load will show the notice (not desktop Chrome or Edge, and not yet dismissed this session). */
export function browserNoticeWillShow(): boolean {
  return !isSupportedBrowser(currentBrowserInfo()) && !browserNoticeDismissed();
}

export const TOUR_SEEN_KEY = 'montage.tourSeen';

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return true; // Without storage we can't remember a dismissal, so don't nag on every load.
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Storage unavailable: nothing to remember.
  }
}
