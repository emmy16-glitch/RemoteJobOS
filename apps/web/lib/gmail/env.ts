export function gmailOAuthEnv() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? "";
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "";
  const redirectUri = process.env.GOOGLE_GMAIL_REDIRECT_URI ?? "";

  return {
    clientId,
    clientSecret,
    encryptionKey,
    redirectUri,
    configured: Boolean(clientId && clientSecret && encryptionKey)
  };
}
