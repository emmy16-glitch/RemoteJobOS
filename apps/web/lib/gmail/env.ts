export const GMAIL_OAUTH_STATE_COOKIE = "remotejobos_gmail_oauth_state";
export const GMAIL_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function gmailOAuthEnv() {
  const clientId = (process.env.GOOGLE_GMAIL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? "").trim();
  const encryptionKey = (process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "").trim();
  const redirectUri = (process.env.GOOGLE_GMAIL_REDIRECT_URI ?? "").trim();

  return {
    clientId,
    clientSecret,
    encryptionKey,
    redirectUri,
    // The redirect URI is required: the token exchange must use a
    // redirect_uri byte-identical to the authorization request, and it must
    // be the public callback URL (never Render's internal request host).
    configured: Boolean(clientId && clientSecret && encryptionKey && redirectUri)
  };
}
