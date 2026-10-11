import { useEffect, useRef, useState } from 'react';
import { browserNoticeWillShow, markBrowserNoticeDismissed } from './visitorPrefs';

/**
 * A dismissible modal shown once per browser session when the app is opened in anything other than desktop
 * Google Chrome. It only warns: closing it (button, Esc) leaves the app fully usable.
 */
export function BrowserNotice({ onClosed }: { onClosed?: () => void } = {}) {
  const [open] = useState(browserNoticeWillShow);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  if (!open) return null;

  const onClose = () => {
    markBrowserNoticeDismissed();
    onClosed?.();
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
        Montage is only supported in Google Chrome on a desktop or laptop computer. It relies on browser
        features for encoding video that other browsers and mobile devices may lack, so previews or exports
        might not work here.
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
