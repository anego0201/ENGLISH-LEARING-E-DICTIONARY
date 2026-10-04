import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Service-worker lifecycle UI. registerType is 'prompt', so a new version never swaps
 * under a reading user — they choose when to reload.
 */
export function UpdateToast() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="chrome pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-safe pb-safe"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-hairline bg-surface-raised/90 p-2 ps-4 shadow-lg backdrop-blur-xl">
        <p className="flex-1 text-sm">
          {needRefresh ? 'A new version is available.' : 'Ready to work offline.'}
        </p>
        {needRefresh && (
          <button
            id="sw-update-reload"
            type="button"
            className="tap rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink active:scale-95 transition-transform"
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
        )}
        <button
          id="sw-update-dismiss"
          type="button"
          className="tap rounded-xl px-3 text-sm text-ink-muted active:scale-95 transition-transform"
          onClick={dismiss}
        >
          {needRefresh ? 'Later' : 'OK'}
        </button>
      </div>
    </div>
  );
}
