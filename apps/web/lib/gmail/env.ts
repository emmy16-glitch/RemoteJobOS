export function gmailOAuthEnv() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? "";
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "";

  return {
    clientId,
    clientSecret,
    encryptionKey,
    configured: Boolean(clientId && clientSecret && encryptionKey)
  };
}
