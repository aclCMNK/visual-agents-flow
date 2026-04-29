import { useEffect, useState } from "react";

interface CredentialsSubformProps {
	username: string;
	password: string;
	isDisabled: boolean;
	show: boolean;
	onUsernameChange: (value: string) => void;
	onPasswordChange: (value: string) => void;
}

export function CredentialsSubform(props: CredentialsSubformProps) {
	const [showPassword, setShowPassword] = useState(false);

	useEffect(() => {
		if (!props.show) {
			setShowPassword(false);
		}
	}, [props.show]);

	return (
		<div
			className={`git-config__credentials${props.show ? " git-config__credentials--visible" : ""}`}
			aria-hidden={props.show ? "false" : "true"}
		>
			<fieldset disabled={props.isDisabled || !props.show}>
				<legend>Authentication</legend>

				<div className="git-config__field">
					<label htmlFor="git-config-cred-username" className="git-config__label">
						Username
					</label>
					<input
						id="git-config-cred-username"
						type="text"
						className="git-config__input"
						value={props.username}
						onChange={(e) => props.onUsernameChange(e.target.value)}
						disabled={props.isDisabled || !props.show}
						aria-required="true"
					/>
				</div>

				<div className="git-config__field">
					<label htmlFor="git-config-cred-password" className="git-config__label">
						Password or Token
					</label>
					<div className="git-config__password-wrapper">
						<input
							id="git-config-cred-password"
							type={showPassword ? "text" : "password"}
							className="git-config__input"
							value={props.password}
							onChange={(e) => props.onPasswordChange(e.target.value)}
							disabled={props.isDisabled || !props.show}
							aria-required="true"
						/>
						<button
							type="button"
							className="git-config__password-toggle"
							onClick={() => setShowPassword((v) => !v)}
							disabled={props.isDisabled || !props.show}
							aria-label={showPassword ? "Hide password" : "Show password"}
						>
							{showPassword ? "🙈" : "👁"}
						</button>
					</div>
				</div>

				<p className="git-config__hint">
					Required for private repositories. Use a personal access token for
					better security.
				</p>
			</fieldset>
		</div>
	);
}
