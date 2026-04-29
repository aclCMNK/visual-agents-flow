interface GitIdentitySubformProps {
	userName: string;
	userEmail: string;
	isDisabled: boolean;
	onUserNameChange: (value: string) => void;
	onUserEmailChange: (value: string) => void;
	userNameError: string | null;
	userEmailError: string | null;
}

export function GitIdentitySubform(props: GitIdentitySubformProps) {
	return (
		<div className="git-config__identity">
			<fieldset disabled={props.isDisabled}>
				<legend>Git Identity</legend>

				<div className="git-config__field">
					<label htmlFor="git-config-identity-name" className="git-config__label">
						Name
					</label>
					<input
						id="git-config-identity-name"
						type="text"
						className={`git-config__input${props.userNameError ? " git-config__input--error" : ""}`}
						value={props.userName}
						onChange={(e) => props.onUserNameChange(e.target.value)}
						disabled={props.isDisabled}
						aria-required="true"
						aria-invalid={props.userNameError ? "true" : "false"}
						aria-describedby={
							props.userNameError ? "git-config-identity-name-error" : undefined
						}
					/>
					{props.userNameError && (
						<p
							id="git-config-identity-name-error"
							className="git-config__validation-error"
							role="alert"
							aria-live="assertive"
						>
							{props.userNameError}
						</p>
					)}
				</div>

				<div className="git-config__field">
					<label htmlFor="git-config-identity-email" className="git-config__label">
						Email
					</label>
					<input
						id="git-config-identity-email"
						type="email"
						className={`git-config__input${props.userEmailError ? " git-config__input--error" : ""}`}
						value={props.userEmail}
						onChange={(e) => props.onUserEmailChange(e.target.value)}
						disabled={props.isDisabled}
						aria-required="true"
						aria-invalid={props.userEmailError ? "true" : "false"}
						aria-describedby={
							props.userEmailError ? "git-config-identity-email-error" : undefined
						}
					/>
					{props.userEmailError && (
						<p
							id="git-config-identity-email-error"
							className="git-config__validation-error"
							role="alert"
							aria-live="assertive"
						>
							{props.userEmailError}
						</p>
					)}
				</div>

				<p className="git-config__hint">
					Used for commits in this repository (local config).
				</p>
			</fieldset>
		</div>
	);
}
