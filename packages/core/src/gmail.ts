import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_REQUIRED_SCOPES: readonly string[] = [
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE
];

export const GOOGLE_OAUTH_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_PROFILE_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";

/**
 * Google returns granted scopes as a space-separated string of full scope
 * URLs. Parse into exact tokens so callers never rely on substring matching
 * (e.g. "gmail.readonly" must not accidentally match a differently-named
 * scope, and surrounding whitespace must not break detection).
 */
export function parseGrantedScopes(value: string | null | undefined): string[] {
  if (!value) return [];
  const tokens = value.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  return [...new Set(tokens)];
}

export function hasGmailScope(
  grantedScope: string | null | undefined,
  scope: string
): boolean {
  return parseGrantedScopes(grantedScope).includes(scope);
}

export function hasGmailReadAccess(
  grantedScope: string | null | undefined
): boolean {
  return hasGmailScope(grantedScope, GMAIL_READONLY_SCOPE);
}

export function hasGmailSendAccess(
  grantedScope: string | null | undefined
): boolean {
  return hasGmailScope(grantedScope, GMAIL_SEND_SCOPE);
}

/** A connection is fully configured only when active AND both scopes granted. */
export function isGmailFullyConfigured(args: {
  active?: boolean | null;
  grantedScope?: string | null;
}): boolean {
  if (!args.active) return false;
  const granted = new Set(parseGrantedScopes(args.grantedScope));
  return GMAIL_REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

export function buildGmailAuthorizationUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_REQUIRED_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", args.state);
  return url.toString();
}

/**
 * Exact form body for the authorization-code exchange. The redirect_uri MUST
 * be byte-identical to the one used in the authorization request.
 */
export function gmailTokenExchangeBody(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Record<string, string> {
  return {
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri
  };
}

function decodeEncryptionKey(rawKey: string): Buffer {
  const key = Buffer.from((rawKey ?? "").trim(), "base64");
  if (key.length !== 32) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    );
  }
  return key;
}

export type EncryptedGmailToken = {
  ciphertext: string;
  iv: string;
  tag: string;
};

/** AES-256-GCM. Format shared by the OAuth callback (web) and workers. */
export function encryptGmailRefreshToken(
  token: string,
  rawEncryptionKey: string
): EncryptedGmailToken {
  if (!token) throw new Error("Cannot encrypt an empty Gmail refresh token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeEncryptionKey(rawEncryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptGmailRefreshToken(
  encrypted: EncryptedGmailToken,
  rawEncryptionKey: string
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeEncryptionKey(rawEncryptionKey),
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

/**
 * Detects revoked/expired refresh tokens from Google token-refresh failures.
 * Such connections must be deactivated so the UI asks for reconnect instead
 * of reporting a stale "Connected" state forever.
 */
export function isRefreshTokenRevoked(message: string | null | undefined): boolean {
  if (!message) return false;
  return /invalid_grant|revoked|expired.*grant|deleted.*client|disabled.*client|unauthorized_client/i.test(
    message
  );
}
