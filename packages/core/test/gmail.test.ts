import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  buildGmailAuthorizationUrl,
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
  gmailTokenExchangeBody,
  hasGmailReadAccess,
  hasGmailSendAccess,
  isGmailFullyConfigured,
  isRefreshTokenRevoked,
  parseGrantedScopes
} from "../src/gmail.ts";

const TEST_KEY = randomBytes(32).toString("base64");

test("scope parser splits Google space-separated scope URLs into exact tokens", () => {
  assert.deepEqual(
    parseGrantedScopes(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"
    ),
    [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE]
  );
});

test("scope parser tolerates extra whitespace and dedupes", () => {
  assert.deepEqual(
    parseGrantedScopes(`  ${GMAIL_READONLY_SCOPE}   ${GMAIL_READONLY_SCOPE} `),
    [GMAIL_READONLY_SCOPE]
  );
  assert.deepEqual(parseGrantedScopes(null), []);
  assert.deepEqual(parseGrantedScopes(""), []);
});

test("read/send access requires exact scope URLs", () => {
  const both = `${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`;
  assert.equal(hasGmailReadAccess(both), true);
  assert.equal(hasGmailSendAccess(both), true);
  assert.equal(hasGmailReadAccess(GMAIL_SEND_SCOPE), false);
  assert.equal(hasGmailSendAccess(GMAIL_READONLY_SCOPE), false);
  assert.equal(hasGmailReadAccess(null), false);
});

test("fully configured requires active plus both scopes", () => {
  const both = `${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`;
  assert.equal(isGmailFullyConfigured({ active: true, grantedScope: both }), true);
  assert.equal(
    isGmailFullyConfigured({ active: true, grantedScope: GMAIL_READONLY_SCOPE }),
    false
  );
  assert.equal(isGmailFullyConfigured({ active: false, grantedScope: both }), false);
  assert.equal(isGmailFullyConfigured({ active: true, grantedScope: null }), false);
});

test("authorization URL uses public redirect URI and offline consent", () => {
  const url = new URL(
    buildGmailAuthorizationUrl({
      clientId: "test-client-id",
      redirectUri: "https://remotejobos.onrender.com/api/gmail/callback",
      state: "random-state"
    })
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://remotejobos.onrender.com/api/gmail/callback"
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("state"), "random-state");
  const scopes = (url.searchParams.get("scope") ?? "").split(" ");
  assert.ok(scopes.includes(GMAIL_READONLY_SCOPE));
  assert.ok(scopes.includes(GMAIL_SEND_SCOPE));
});

test("token exchange body uses the exact redirect URI", () => {
  const body = gmailTokenExchangeBody({
    clientId: "id",
    clientSecret: "secret",
    code: "auth-code",
    redirectUri: "https://remotejobos.onrender.com/api/gmail/callback"
  });
  assert.equal(body.grant_type, "authorization_code");
  assert.equal(body.redirect_uri, "https://remotejobos.onrender.com/api/gmail/callback");
  assert.equal(body.code, "auth-code");
});

test("encryption rejects malformed keys", () => {
  assert.throws(() => encryptGmailRefreshToken("token", ""), /32-byte/);
  assert.throws(
    () => encryptGmailRefreshToken("token", Buffer.from("short").toString("base64")),
    /32-byte/
  );
  assert.throws(
    () => decryptGmailRefreshToken({ ciphertext: "eA==", iv: "bg==", tag: "Zw==" }, "not-base64-32-bytes!!!!!!!!"),
    /32-byte/
  );
});

test("encryption round-trips the refresh token", () => {
  const encrypted = encryptGmailRefreshToken("refresh-token-value", TEST_KEY);
  assert.ok(encrypted.ciphertext.length > 0);
  assert.ok(encrypted.iv.length > 0);
  assert.ok(encrypted.tag.length > 0);
  assert.equal(decryptGmailRefreshToken(encrypted, TEST_KEY), "refresh-token-value");
});

test("encryption is randomized but key-bound", () => {
  const first = encryptGmailRefreshToken("same-token", TEST_KEY);
  const second = encryptGmailRefreshToken("same-token", TEST_KEY);
  assert.notEqual(first.ciphertext, second.ciphertext);
  const otherKey = randomBytes(32).toString("base64");
  assert.throws(() => decryptGmailRefreshToken(first, otherKey));
});

test("revoked refresh tokens are detected", () => {
  assert.equal(isRefreshTokenRevoked("invalid_grant: Token has been expired or revoked."), true);
  assert.equal(isRefreshTokenRevoked("Requested entity was not found"), false);
  assert.equal(isRefreshTokenRevoked(null), false);
  assert.equal(isRefreshTokenRevoked("Gmail list failed: 500"), false);
});
