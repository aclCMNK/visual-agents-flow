/**
 * src/ui/components/ExportModal/MarkdownViewer.tsx
 *
 * Read-only Markdown renderer for the ExportModal.
 *
 * Renders Markdown content (titles, lists, code blocks, etc.) using the
 * same `marked` library already used in MarkdownEditor.tsx (AssetPanel).
 *
 * Features:
 *   - GFM (GitHub Flavored Markdown) + line breaks enabled
 *   - Scrollable container — handles long content gracefully
 *   - Accessible: role="region" + aria-label passed by the caller
 *   - Responsive: fills its parent container width
 *   - Styled via `.export-modal__md-viewer` CSS class (app.css)
 *
 * Usage:
 *   <MarkdownViewer
 *     content={markdownString}
 *     aria-label="Agent profile content"
 *     className="optional-extra-class"
 *   />
 */

import { marked } from "marked";

// ── Marked configuration (GFM + breaks, same as MarkdownEditor) ───────────
// marked.setOptions is global — if MarkdownEditor already ran this, it's a no-op.
// We call it here defensively so MarkdownViewer works in isolation too.
marked.setOptions({ gfm: true, breaks: true });

// ── Props ──────────────────────────────────────────────────────────────────

interface MarkdownViewerProps {
  /** Raw Markdown string to render */
  content: string;
  /** Accessible label for the region (required for screen readers) */
  "aria-label": string;
  /** Optional extra CSS class names appended to the container */
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function MarkdownViewer({ content, "aria-label": ariaLabel, className }: MarkdownViewerProps) {
  const html = marked.parse(content || "") as string;

  const classes = [
    "export-modal__md-viewer",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      role="region"
      aria-label={ariaLabel}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output is local .md content only
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
