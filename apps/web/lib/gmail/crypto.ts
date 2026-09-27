import "server-only";
import { createCipheriv, randomBytes } from "node:crypto";
import { gmailOAuthEnv } from "./env";

function encryptionKey(): Buffer {
  const raw = gmailOAuthEnv().encryptionKey;
  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    );
  }

  return key;
}

export function encryptGmailRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}
