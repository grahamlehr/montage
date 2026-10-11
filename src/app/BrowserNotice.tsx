import { useEffect, useRef, useState } from 'react';
import { currentBrowserInfo, isSupportedBrowser } from './browserSupport';

const DISMISSED_KEY = 'montage.browserNoticeDismissed';

function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A dismissible modal shown once per browser session when the app is opened in anything other than desktop
 * Google Chrome. It only warns: closing it (button, Esc) leaves the app fully usable.
 */
export function BrowserNotice() {
  const [open] = useState(() => !isSupportedBrowser(currentBrowserInfo()) && !wasDismissed());
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  if (!open) return null;

  const onClose = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Storage unavailable (private mode etc.): the notice just shows again next load.
    }
  };

  return (
    <dialog
      ref={ref}
      className="app-notice"
      aria-labelledby="browser-notice-title"
      data-testid="browser-notice"
      onClose={onClose}
    >
      <h2 id="browser-notice-title">Best in Chrome on desktop</h2>
      <p>
        Montage is only supported in Google Chrome on a desktop or laptop computer. It relies on browser features
        for encoding video that other browsers and mobile devices may lack, so previews or exports might not work
        here.
      </p>
      <p>You can still try it.</p>
      <form method="dialog">
        <button className="app-btn app-ink" data-testid="browser-notice-dismiss" autoFocus>
          Continue anyway
        </button>
      </form>
    </dialog>
  );
}
