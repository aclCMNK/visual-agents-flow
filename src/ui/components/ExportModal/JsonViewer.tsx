/**
 * src/ui/components/ExportModal/JsonViewer.tsx
 *
 * Lightweight, read-only JSON viewer for the ExportModal Agent subsection.
 *
 * # Package used
 *   react-json-pretty@2.2.0
 *   https://github.com/chenckang/react-json-pretty
 *
 *   Chosen because:
 *   - Very lightweight (no expand/collapse, no editing, pure display)
 *   - Renders syntax-highlighted JSON with colored tokens
 *   - Zero dependencies beyond React
 *   - Does NOT include react-json-view (heavier, includes editing UI)
 *
 * # Theme
 *   Monikai (dark background #272822 — Monokai-inspired).
 *   Colors are applied via inline style props on react-json-pretty.
 *   The wrapper background + scroll are handled by the .json-viewer CSS class
 *   defined in app.css.
 *
 * # Constraints
 *   - Read-only: no expand/collapse, no editing
 *   - Scroll: vertical scroll when content overflows (via .json-viewer CSS)
 *   - Width: 100% of parent panel — does NOT expand beyond the panel
 *   - Responsive: inherits panel width via CSS
 */

import React from "react";
import JSONPretty from "react-json-pretty";

// ── Props ─────────────────────────────────────────────────────────────────

export interface JsonViewerProps {
  /** JSON string to display. If invalid JSON, shown as-is with error styling. */
  json: string;
  /** Additional CSS class applied to the wrapper div. */
  className?: string;
  /** Accessible label for the region. */
  "aria-label"?: string;
}

// ── Component ─────────────────────────────────────────────────────────────

export function JsonViewer({ json, className = "", "aria-label": ariaLabel }: JsonViewerProps) {
  // Parse to object so react-json-pretty can pretty-print with indentation.
  // If parsing fails, pass the raw string — react-json-pretty shows it gracefully.
  let data: unknown = json;
  if (typeof json === "string" && json.trim()) {
    try {
      data = JSON.parse(json);
    } catch {
      data = json;
    }
  }

  return (
    <div
      className={`json-viewer ${className}`.trim()}
      role="region"
      aria-label={ariaLabel ?? "JSON content"}
    >
      <JSONPretty
        data={data}
        // Monokai-inspired inline styles — no external CSS file needed
        mainStyle="line-height:1.5;font-size:0.82rem;font-family:'JetBrains Mono','Fira Mono','Consolas',monospace;background:transparent;padding:0;margin:0;word-break:break-all;"
        keyStyle="color:#f92672;"
        stringStyle="color:#fd971f;"
        valueStyle="color:#a6e22e;"
        booleanStyle="color:#66d9ef;"
      />
    </div>
  );
}
