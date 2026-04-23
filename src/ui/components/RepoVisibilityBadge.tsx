/**
 * src/ui/components/RepoVisibilityBadge.tsx
 *
 * Displays a color-coded status message indicating whether a Git repository
 * URL has been detected as public, private, or in another non-queryable state.
 *
 * Renders nothing for "idle" and "invalid_url" statuses — those are handled
 * by the URL validation error message already present in the modal.
 */

import type { VisibilityStatus } from "../utils/repoVisibility.ts";

// ── Config ─────────────────────────────────────────────────────────────────

interface VisibilityConfig {
	color: string;
	message: string;
	isSpinner?: boolean;
}

const VISIBILITY_CONFIG: Partial<Record<VisibilityStatus, VisibilityConfig>> = {
	checking: {
		color: "#9ca3af", // neutral gray
		message: "Checking repository…",
		isSpinner: true,
	},
	public: {
		color: "#22c55e", // green-500
		message: "✓ Public repository detected",
	},
	private: {
		color: "#ef4444", // red-500
		message: "✗ Private repository — credentials required",
	},
	not_found: {
		color: "#ef4444", // red-500 — treated same as private
		message: "✗ Private repository — credentials required",
	},
	ssh_url: {
		color: "#f59e0b", // amber-500
		message: "⚠ SSH URL detected — visibility cannot be verified",
	},
	unknown_provider: {
		color: "#f59e0b", // amber-500
		message:
			"⚠ Visibility check is only supported for GitHub repositories. GitLab and Bitbucket are not supported by the IPC proxy.",
	},
	network_error: {
		color: "#f97316", // orange-500
		message:
			"⚠ Could not verify visibility (network error, timeout, or IPC proxy unavailable)",
	},
};

// ── Spinner styles (inline — no external deps) ─────────────────────────────

const SPINNER_STYLE: React.CSSProperties = {
	display: "inline-block",
	width: 10,
	height: 10,
	border: "2px solid currentColor",
	borderTopColor: "transparent",
	borderRadius: "50%",
	animation: "repo-visibility-spin 0.6s linear infinite",
	marginRight: 6,
	verticalAlign: "middle",
};

// ── Props ──────────────────────────────────────────────────────────────────

interface RepoVisibilityBadgeProps {
	status: VisibilityStatus;
}

// ── Component ──────────────────────────────────────────────────────────────

export function RepoVisibilityBadge({ status }: RepoVisibilityBadgeProps) {
	// Do not render anything for terminal/non-visible states
	if (status === "idle" || status === "invalid_url") return null;

	const config = VISIBILITY_CONFIG[status];
	if (!config) return null;

	return (
		<>
			{/* Keyframe injected once — safe to repeat (browser dedupes) */}
			<style>{`
        @keyframes repo-visibility-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

			<div
				role="status"
				aria-live="polite"
				style={{
					color: config.color,
					fontSize: "0.85rem",
					marginTop: 4,
					display: "flex",
					alignItems: "center",
				}}
			>
				{config.isSpinner && <span style={SPINNER_STYLE} aria-hidden="true" />}
				<span>{config.message}</span>
			</div>
		</>
	);
}
