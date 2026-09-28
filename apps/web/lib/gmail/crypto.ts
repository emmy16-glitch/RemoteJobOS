import "server-only";
import {
  decryptGmailRefreshToken as decryptWithKey,
  encryptGmailRefreshToken as encryptWithKey,
  type EncryptedGmailToken
} from "@remotejobos/core";
import { gmailOAuthEnv } from "./env";

export type { EncryptedGmailToken };

/**
 * Thin server-only wrapper: the AES-256-GCM format lives in
 * @remotejobos/core so the OAuth callback and the Gmail workers provably
 * share one implementation. The key itself is never logged.
 */
export function encryptGmailRefreshToken(token: string) {
  return encryptWithKey(token, gmailOAuthEnv().encryptionKey);
}

export function decryptGmailRefreshToken(encrypted: EncryptedGmailToken) {
  return decryptWithKey(encrypted, gmailOAuthEnv().encryptionKey);
}
