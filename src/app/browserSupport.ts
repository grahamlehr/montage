/** What we read from `navigator` to decide whether this is desktop Google Chrome. */
export interface BrowserInfo {
  userAgent: string;
  /** `navigator.userAgentData` (Chromium only); absent in Firefox and Safari. */
  userAgentData?: { brands?: readonly { brand: string }[]; mobile?: boolean } | undefined;
}

// Chromium-based browsers that put "Chrome/" in their UA string but aren't Google Chrome.
const OTHER_CHROMIUM = /\b(Edg|EdgA|EdgiOS|OPR|OPT|SamsungBrowser|YaBrowser|Vivaldi|UCBrowser|Brave)\//;
const MOBILE = /\b(Android|Mobile|iPhone|iPad|iPod)\b/;

/**
 * True for Google Chrome on desktop, the only browser Montage supports (PLAN.md §1). The UA string must
 * look like desktop Chrome, and when User-Agent Client Hints are available their brands must include
 * Google Chrome (which rules out Edge, Brave, Opera… that also say "Chrome/") and not report mobile.
 */
export function isSupportedBrowser({ userAgent, userAgentData }: BrowserInfo): boolean {
  if (!/\b(?:Headless)?Chrome\/\d+/.test(userAgent) || OTHER_CHROMIUM.test(userAgent) || MOBILE.test(userAgent)) return false;
  if (userAgentData) {
    if (userAgentData.mobile) return false;
    const brands = userAgentData.brands ?? [];
    if (brands.length > 0 && !brands.some((b) => b.brand === 'Google Chrome' || b.brand === 'HeadlessChrome')) {
      return false;
    }
  }
  return true;
}

export function currentBrowserInfo(): BrowserInfo {
  const nav = navigator as Navigator & { userAgentData?: BrowserInfo['userAgentData'] };
  return { userAgent: nav.userAgent, userAgentData: nav.userAgentData };
}
