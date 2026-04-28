import type { GitOperationError } from "../../electron/bridge.types.ts";

export const GIT_ERROR_MAX_LENGTH = 300;

export interface UiGitError {
	displayMessage: string;
	fullMessage: string;
}

export function toUiGitError(
	message: string,
	maxLength = GIT_ERROR_MAX_LENGTH,
): UiGitError {
	const fullMessage = (message || "").trim() || "An unexpected Git error occurred.";
	return {
		fullMessage,
		displayMessage: truncateGitOutput(fullMessage, maxLength),
	};
}

export function formatGitError(
	error: GitOperationError,
	maxLength = GIT_ERROR_MAX_LENGTH,
): UiGitError {
	switch (error.code) {
		case "E_NOT_A_GIT_REPO":
			return toUiGitError("This directory is not a Git repository.", maxLength);
		case "E_NOTHING_TO_COMMIT":
			return toUiGitError("Nothing to commit. Working tree is clean.", maxLength);
		case "E_EMPTY_COMMIT_MSG":
			return toUiGitError("Commit message cannot be empty.", maxLength);
		case "E_GIT_NOT_FOUND":
			return toUiGitError("Git is not installed or not found in PATH.", maxLength);
		case "E_TIMEOUT":
			return toUiGitError("Git operation timed out. Try again.", maxLength);
		case "E_MERGE_CONFLICT":
			return formatKnownErrorWithDetail(
				"Pull failed due to merge conflicts.",
				error.gitStderr ?? error.rawOutput,
				maxLength,
			);
		case "E_DIRTY_WORKING_DIR":
			return formatKnownErrorWithDetail(
				"Uncommitted changes block this operation.",
				error.gitStderr ?? error.rawOutput,
				maxLength,
			);
		case "E_NO_REMOTE":
			return toUiGitError("No remote configured or remote unreachable.", maxLength);
		case "E_BRANCH_NOT_FOUND":
			return toUiGitError(error.message || "Branch not found.", maxLength);
		case "E_BRANCH_ALREADY_EXISTS":
			return toUiGitError(error.message || "Branch already exists.", maxLength);
		case "E_INVALID_BRANCH_NAME":
			return toUiGitError(error.message || "Invalid branch name.", maxLength);
		default: {
			const full =
				cleanGitText(error.gitStderr) ||
				cleanGitText(error.rawOutput) ||
				cleanGitText(error.message) ||
				"An unexpected Git error occurred.";
			return {
				fullMessage: full,
				displayMessage: truncateGitOutput(full, maxLength),
			};
		}
	}
}

function formatKnownErrorWithDetail(
	baseMessage: string,
	detail: string | undefined,
	maxLength: number,
): UiGitError {
	const cleanDetail = cleanGitText(detail);
	if (!cleanDetail) {
		return toUiGitError(baseMessage, maxLength);
	}

	const firstUsefulLine = extractFirstUsefulLine(cleanDetail);
	const display = firstUsefulLine
		? `${baseMessage}\n${firstUsefulLine}`
		: baseMessage;

	return {
		fullMessage: `${baseMessage}\n${cleanDetail}`,
		displayMessage: truncateGitOutput(display, maxLength),
	};
}

function cleanGitText(text: string | undefined): string {
	return (text || "").trim();
}

function truncateGitOutput(text: string, maxLength: number): string {
	if (!text) return "";
	const cleaned = text.trim();
	if (cleaned.length <= maxLength) return cleaned;
	const truncated = cleaned.slice(0, maxLength);
	const lastNewline = truncated.lastIndexOf("\n");
	const lastSpace = truncated.lastIndexOf(" ");
	const cutAt =
		lastNewline > maxLength * 0.6
			? lastNewline
			: lastSpace > 0
				? lastSpace
				: maxLength;
	return `${cleaned.slice(0, cutAt).trim()}…`;
}

function extractFirstUsefulLine(text: string): string {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	for (const line of lines) {
		if (/^(error|fatal|warning|hint):?\s*$/i.test(line)) continue;
		return line;
	}

	return lines[0] ?? "";
}
