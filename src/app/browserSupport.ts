/** What we read from `navigator` to decide whether this is desktop Google Chrome or Microsoft Edge. */
export interface BrowserInfo {
  userAgent: string;
  /** `navigator.userAgentData` (Chromium only); absent in Firefox and Safari. */
  userAgentData?: { brands?: readonly { brand: string }[]; mobile?: boolean } | undefined;
}

// Chromium-based browsers that put "Chrome/" in their UA string but aren't Google Chrome or desktop Edge.
// (Desktop Edge says "Edg/"; its mobile builds say "EdgA/" / "EdgiOS/" and are caught here or by MOBILE.)
const OTHER_CHROMIUM = /\b(EdgA|EdgiOS|OPR|OPT|SamsungBrowser|YaBrowser|Vivaldi|UCBrowser|Brave)\//;
const SUPPORTED_BRANDS = new Set(['Google Chrome', 'Microsoft Edge', 'HeadlessChrome']);
const MOBILE = /\b(Android|Mobile|iPhone|iPad|iPod)\b/;

/**
 * True for Google Chrome or Microsoft Edge on desktop, the browsers Montage supports (PLAN.md §1; Edge is
 * Chromium with the same WebCodecs H.264 encoders). The UA string must look like desktop Chrome, and when
 * User-Agent Client Hints are available their brands must include Google Chrome or Microsoft Edge (which
 * rules out Brave, Opera… that also say "Chrome/") and not report mobile.
 */
export function isSupportedBrowser({ userAgent, userAgentData }: BrowserInfo): boolean {
  if (!/\b(?:Headless)?Chrome\/\d+/.test(userAgent) || OTHER_CHROMIUM.test(userAgent) || MOBILE.test(userAgent)) return false;
  if (userAgentData) {
    if (userAgentData.mobile) return false;
    const brands = userAgentData.brands ?? [];
    if (brands.length > 0 && !brands.some((b) => SUPPORTED_BRANDS.has(b.brand))) {
      return false;
    }
  }
  return true;
}

export function currentBrowserInfo(): BrowserInfo {
  const nav = navigator as Navigator & { userAgentData?: BrowserInfo['userAgentData'] };
  return { userAgent: nav.userAgent, userAgentData: nav.userAgentData };
}
