/**
 * src/ui/components/AssetPanel/AssetToasts.tsx
 *
 * Toast notification area for the Assets panel.
 * Renders at the bottom-right of the panel. Each toast auto-dismisses.
 */

import { useAssetStore } from "../../store/assetStore.ts";

export function AssetToasts() {
  const { toasts, dismissToast } = useAssetStore();

  if (toasts.length === 0) return null;

  return (
    <div className="asset-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`asset-toast asset-toast--${t.kind}`}
          role="status"
        >
          <span className="asset-toast__icon" aria-hidden="true">
            {t.kind === "success" ? "✅" : t.kind === "error" ? "❌" : "ℹ️"}
          </span>
          <span className="asset-toast__msg">{t.message}</span>
          <button
            className="asset-toast__close"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
