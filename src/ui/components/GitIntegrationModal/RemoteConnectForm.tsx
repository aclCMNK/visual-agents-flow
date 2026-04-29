import { useEffect, useMemo, useState } from "react";
import type { VisibilityStatus } from "../../utils/repoVisibility.ts";
import { RepoVisibilityBadge } from "../RepoVisibilityBadge.tsx";
import { CredentialsSubform } from "./CredentialsSubform.tsx";
import { GitIdentitySubform } from "./GitIdentitySubform.tsx";
import type { ConnectParams } from "../../hooks/useGitConfig.ts";

interface RemoteConnectFormProps {
	initialUrl?: string;
	initialUserName?: string;
	initialUserEmail?: string;
	isConnecting: boolean;
	connectError: string | null;
	visibilityStatus: VisibilityStatus;
	onUrlChange: (url: string) => void;
	onConnect: (params: ConnectParams) => void;
	onCancel?: () => void;
}

function isValidGitUrl(url: string): boolean {
	const trimmed = url.trim();
	return (
		trimmed.startsWith("https://") ||
		trimmed.startsWith("http://") ||
		trimmed.startsWith("git@") ||
		trimmed.startsWith("ssh://")
	);
}

function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function RemoteConnectForm(props: RemoteConnectFormProps) {
	const [url, setUrl] = useState(props.initialUrl ?? "");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [userName, setUserName] = useState(props.initialUserName ?? "");
	const [userEmail, setUserEmail] = useState(props.initialUserEmail ?? "");

	useEffect(() => {
		setUrl(props.initialUrl ?? "");
	}, [props.initialUrl]);

	useEffect(() => {
		setUserName(props.initialUserName ?? "");
	}, [props.initialUserName]);

	useEffect(() => {
		setUserEmail(props.initialUserEmail ?? "");
	}, [props.initialUserEmail]);

	const showCredentials = props.visibilityStatus === "private";

	useEffect(() => {
		if (!showCredentials) {
			setUsername("");
			setPassword("");
		}
	}, [showCredentials]);

	const urlError = useMemo(() => {
		if (url.trim() === "") return null;
		if (!isValidGitUrl(url)) return "Invalid URL format. Use HTTPS or SSH.";
		return null;
	}, [url]);

	const userNameError = useMemo(() => {
		if (!userName.trim()) return "Name is required.";
		return null;
	}, [userName]);

	const userEmailError = useMemo(() => {
		if (!userEmail.trim()) return "Email is required.";
		if (!isValidEmail(userEmail)) return "Enter a valid email address.";
		return null;
	}, [userEmail]);

	const shouldShowVisibilityBadge =
		url.trim() !== "" &&
		isValidGitUrl(url) &&
		props.visibilityStatus !== "idle" &&
		props.visibilityStatus !== "invalid_url";

	const isFormValid = useMemo(() => {
		if (!isValidGitUrl(url)) return false;
		if (props.visibilityStatus === "private") {
			if (!username.trim()) return false;
			if (!password.trim()) return false;
		}
		if (!userName.trim()) return false;
		if (!isValidEmail(userEmail)) return false;
		return true;
	}, [url, props.visibilityStatus, username, password, userName, userEmail]);

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!isFormValid || props.isConnecting) return;

		props.onConnect({
			url: url.trim(),
			credentials: showCredentials
				? {
					username: username.trim(),
					password: password.trim(),
				}
				: undefined,
			userName: userName.trim(),
			userEmail: userEmail.trim(),
		});
	}

	return (
		<form onSubmit={handleSubmit}>
			<div className="git-config__field">
				<label htmlFor="git-config-remote-url" className="git-config__label">
					Remote URL
				</label>
				<input
					id="git-config-remote-url"
					type="url"
					className={`git-config__input${urlError ? " git-config__input--error" : ""}`}
					placeholder="https://github.com/org/repo.git"
					value={url}
					onChange={(e) => {
						setUrl(e.target.value);
						props.onUrlChange(e.target.value);
					}}
					disabled={props.isConnecting}
					maxLength={2000}
					aria-required="true"
					aria-invalid={urlError ? "true" : "false"}
					aria-describedby={urlError ? "git-config-url-error" : "git-config-url-hint"}
				/>
				{urlError ? (
					<p
						id="git-config-url-error"
						className="git-config__validation-error"
						role="alert"
						aria-live="assertive"
					>
						{urlError}
					</p>
				) : (
					<p id="git-config-url-hint" className="git-config__hint">
						Use HTTPS or SSH remote URL.
					</p>
				)}
				{shouldShowVisibilityBadge && (
					<RepoVisibilityBadge status={props.visibilityStatus} />
				)}
			</div>

			<CredentialsSubform
				username={username}
				password={password}
				isDisabled={props.isConnecting}
				show={showCredentials}
				onUsernameChange={setUsername}
				onPasswordChange={setPassword}
			/>

			<GitIdentitySubform
				userName={userName}
				userEmail={userEmail}
				isDisabled={props.isConnecting}
				onUserNameChange={setUserName}
				onUserEmailChange={setUserEmail}
				userNameError={userNameError}
				userEmailError={userEmailError}
			/>

			{props.connectError && (
				<div className="git-branches__error-banner" role="alert">
					{props.connectError}
				</div>
			)}

			<div className="git-config__form-actions">
				{props.onCancel && (
					<button
						type="button"
						className="btn btn--ghost"
						onClick={props.onCancel}
						disabled={props.isConnecting}
						aria-label="Cancel remote URL change"
					>
						Cancel
					</button>
				)}
				<button
					type="submit"
					className="btn btn--primary"
					disabled={!isFormValid || props.isConnecting}
					aria-busy={props.isConnecting ? "true" : "false"}
				>
					{props.isConnecting ? "Connecting…" : "Connect"}
				</button>
			</div>
		</form>
	);
}
