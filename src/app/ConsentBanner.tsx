import { setConsent } from './analytics';
import { useConsent } from './visitorPrefs';

/**
 * Cookie consent bar, pinned to the bottom of the window until the visitor chooses. Accept and Decline carry
 * equal weight; the header's "Cookies" link reopens it (`open`) so the choice can be changed later.
 */
export function ConsentBanner({ open, onClose }: { open: boolean; onClose(): void }) {
  const consent = useConsent();
  if (consent !== null && !open) return null;

  const choose = (c: 'granted' | 'denied') => {
    setConsent(c);
    onClose();
  };

  return (
    <section className="app-consent" role="region" aria-label="Cookie consent" data-testid="consent-banner">
      <div className="app-consent-text">
        <h2>Cookies</h2>
        <p>
          With your permission, Montage uses Google Analytics cookies to count visits and see which features
          get used. Your photos are never uploaded or tracked: they stay in this browser.
          {consent && (
            <span className="app-consent-current" data-testid="consent-current">
              {' '}
              Currently: analytics {consent === 'granted' ? 'allowed' : 'declined'}.
            </span>
          )}
        </p>
      </div>
      <div className="app-consent-actions">
        <button
          type="button"
          className="app-btn"
          data-testid="consent-decline"
          onClick={() => choose('denied')}
        >
          Decline
        </button>
        <button
          type="button"
          className="app-btn app-ink"
          data-testid="consent-accept"
          onClick={() => choose('granted')}
        >
          Accept analytics
        </button>
      </div>
    </section>
  );
}
