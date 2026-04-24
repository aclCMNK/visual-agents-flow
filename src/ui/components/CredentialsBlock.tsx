/**
 * src/ui/components/CredentialsBlock.tsx
 *
 * Pure, controlled component that renders Username and Personal Access Token
 * fields for authenticating against private GitHub repositories.
 *
 * Design rules:
 *   - No side-effects: all state lives in the parent via controlled props.
 *   - No persistence: credentials are never stored outside the call stack.
 *   - SECURITY: Do NOT log credentials anywhere in this component.
 *   - Prepared for future providers via the extensible props shape.
 *
 * CSS: BEM classes defined in CredentialsBlock.css (imported below).
 * Animation: `credentials-block--enter` / `credentials-block--leave` keyframes.
 */

import "./CredentialsBlock.css";

// ── Exported types ──────────────────────────────────────────────────────────

export type Credentials = { username: string; token: string };

export type CredentialsValidation = {
	usernameOk?: boolean;
	tokenOk?: boolean;
};

export type CredentialsBlockProps = {
	credentials: Credentials;
	onChange: (next: Credentials) => void;
	onClear?: () => void;
	disabled?: boolean;
	/** Controls visibility and enter/leave animation */
	show?: boolean;
	validation?: CredentialsValidation;
	ariaLabels?: { username?: string; token?: string };
};

// ── Component ───────────────────────────────────────────────────────────────

export function CredentialsBlock({
	credentials,
	onChange,
	onClear,
	disabled = false,
	show = true,
	validation,
	ariaLabels,
}: CredentialsBlockProps) {
	// ── Derived validation flags ────────────────────────────────────────────
	// `usernameOk` / `tokenOk` are explicitly false (not undefined) when the
	// parent has touched the field and the value is empty.
	const usernameError = validation?.usernameOk === false;
	const tokenError = validation?.tokenOk === false;

	// ── Handlers ────────────────────────────────────────────────────────────
	// SECURITY: Do NOT log credentials
	const onUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange({ ...credentials, username: e.target.value });
	};

	const onTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange({ ...credentials, token: e.target.value });
	};

	const onClearClick = () => {
		onChange({ username: "", token: "" });
		if (onClear) onClear();
	};

	// ── Render ───────────────────────────────────────────────────────────────
	return (
		<div
			className={[
				"credentials-block",
				show ? "credentials-block--enter" : "credentials-block--leave",
			].join(" ")}
			aria-hidden={!show}
		>
			{/* ── Warning hint ──────────────────────────────────────────── */}
			<p className="form-field__hint form-field__hint--warn credentials-block__warn">
				Credenciales necesarias para clonar repos privados.
			</p>

			{/* ── Username ──────────────────────────────────────────────── */}
			<div className="credentials-block__field form-field">
				<label
					htmlFor="credentials-username"
					className="credentials-block__label form-field__label"
				>
					Username{" "}
					<span aria-hidden="true" className="form-field__required">
						*
					</span>
				</label>
				<input
					id="credentials-username"
					type="text"
					className={[
						"form-field__input",
						"credentials-block__input",
						usernameError ? "form-field__input--error" : "",
					]
						.join(" ")
						.trim()}
					value={credentials.username}
					onChange={onUsernameChange}
					disabled={disabled}
					autoComplete="off"
					spellCheck={false}
					aria-label={ariaLabels?.username ?? "GitHub username"}
					aria-describedby={
						usernameError ? "credentials-username-hint" : undefined
					}
					aria-invalid={usernameError ? "true" : undefined}
				/>
				{usernameError ? (
					<div
						id="credentials-username-hint"
						className="credentials-block__hint form-field__hint form-field__hint--error"
						role="alert"
					>
						Requerido
					</div>
				) : null}
			</div>

			{/* ── Personal Access Token ─────────────────────────────────── */}
			<div className="credentials-block__field form-field">
				<label
					htmlFor="credentials-token"
					className="credentials-block__label form-field__label"
				>
					Personal Access Token{" "}
					<span aria-hidden="true" className="form-field__required">
						*
					</span>
				</label>
				<input
					id="credentials-token"
					type="password"
					className={[
						"form-field__input",
						"credentials-block__input",
						tokenError ? "form-field__input--error" : "",
					]
						.join(" ")
						.trim()}
					value={credentials.token}
					onChange={onTokenChange}
					disabled={disabled}
					autoComplete="new-password"
					placeholder="ghp_xxx... (no guardar)"
					aria-label={ariaLabels?.token ?? "GitHub Personal Access Token"}
					aria-describedby="credentials-token-hint"
					aria-invalid={tokenError ? "true" : undefined}
				/>
				<div
					id="credentials-token-hint"
					className={[
						"credentials-block__hint",
						"form-field__hint",
						tokenError ? "form-field__hint--error" : "form-field__hint--info",
					].join(" ")}
					role={tokenError ? "alert" : undefined}
				>
					{tokenError
						? "Requerido"
						: "Usa un token con scope repo (o scope mínimo requerido). No guardamos este token."}
				</div>
			</div>

			{/* ── Clear button ──────────────────────────────────────────── */}
			{(credentials.username || credentials.token) && (
				<button
					type="button"
					className="btn btn--ghost credentials-block__clear-btn"
					onClick={onClearClick}
					disabled={disabled}
					aria-label="Clear credentials"
				>
					Limpiar credenciales
				</button>
			)}
		</div>
	);
}
