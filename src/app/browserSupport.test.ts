import { describe, expect, it } from 'vitest';
import { isSupportedBrowser } from './browserSupport';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const chromeBrands = { brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }, { brand: 'Not.A/Brand' }], mobile: false };

describe('isSupportedBrowser', () => {
  it('accepts desktop Google Chrome', () => {
    expect(isSupportedBrowser({ userAgent: CHROME_MAC, userAgentData: chromeBrands })).toBe(true);
    expect(isSupportedBrowser({ userAgent: CHROME_WIN, userAgentData: chromeBrands })).toBe(true);
    // Client hints unavailable (e.g. insecure context): fall back to the UA string.
    expect(isSupportedBrowser({ userAgent: CHROME_MAC })).toBe(true);
    // Headless Chrome (automated tests) is still desktop Chrome.
    expect(isSupportedBrowser({ userAgent: CHROME_MAC.replace('Chrome/', 'HeadlessChrome/') })).toBe(true);
  });

  it('rejects other desktop browsers', () => {
    const cases = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      `${CHROME_WIN} Edg/141.0.0.0`,
      `${CHROME_WIN} OPR/115.0.0.0`,
    ];
    for (const userAgent of cases) expect(isSupportedBrowser({ userAgent }), userAgent).toBe(false);
    // Edge / Brave without a giveaway in the UA string are caught by their client-hint brands.
    const edge = { brands: [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }], mobile: false };
    const brave = { brands: [{ brand: 'Brave' }, { brand: 'Chromium' }], mobile: false };
    expect(isSupportedBrowser({ userAgent: CHROME_WIN, userAgentData: edge })).toBe(false);
    expect(isSupportedBrowser({ userAgent: CHROME_WIN, userAgentData: brave })).toBe(false);
  });

  it('rejects mobile and tablet browsers, Chrome included', () => {
    const cases = [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ];
    for (const userAgent of cases) expect(isSupportedBrowser({ userAgent }), userAgent).toBe(false);
    expect(isSupportedBrowser({ userAgent: CHROME_WIN, userAgentData: { ...chromeBrands, mobile: true } })).toBe(false);
  });
});
