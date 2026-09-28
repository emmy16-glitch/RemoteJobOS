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
    configured: Boolean(clientId && clientSecret && encryptionKey)
  };
}
