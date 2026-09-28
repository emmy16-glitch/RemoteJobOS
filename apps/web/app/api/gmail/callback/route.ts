import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authenticatedUserId } from "../../../../lib/auth";
import { createAdminSupabaseClient } from "../../../../lib/supabase/admin";
import { serverSupabaseEnv } from "../../../../lib/supabase/env";
import { encryptGmailRefreshToken } from "../../../../lib/gmail/crypto";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  gmailOAuthEnv
} from "../../../../lib/gmail/env";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GmailProfile = {
  emailAddress?: string;
};

const DEFAULT_GRANTED_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

function safeStateEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicBaseUrl(request: NextRequest) {
  const env = gmailOAuthEnv();
  if (env.redirectUri) {
    return new URL(env.redirectUri).origin;
  }
  return new URL(request.url).origin;
}

function withClearedStateCookie(response: NextResponse) {
  // Expire the short-lived OAuth state cookie on every callback exit so a
  // stale state value can never be replayed or mismatch a later attempt.
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  return response;
}

function redirectWithError(request: NextRequest, message: string) {
  return withClearedStateCookie(
    NextResponse.redirect(
      new URL("/inbox?error=" + encodeURIComponent(message), publicBaseUrl(request)),
      302
    )
  );
}

/**
 * Best-effort persistence of a human-readable connection error so /inbox can
 * show why Gmail is not connected. Never throws; never touches token columns.
 * Uses the service-role client because the row may not exist yet and the
 * browser session must never be able to write token fields.
 */
async function recordConnectionError(userId: string, message: string) {
  try {
    if (!serverSupabaseEnv().configured) return;
    const admin = createAdminSupabaseClient();
    await admin
      .from("gmail_connections")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("owner_id", userId);
  } catch {
    // Diagnostics only — the user-facing redirect already carries the error.
  }
}

export async function GET(request: NextRequest) {
  console.info("[gmail-callback] received", {
    host: request.nextUrl.host,
    hasCode: Boolean(request.nextUrl.searchParams.get("code")),
    hasState: Boolean(request.nextUrl.searchParams.get("state")),
    hasStateCookie: Boolean(request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value)
  });

  // The proxy refreshes the Supabase session before this route runs but never
  // redirects it, so a missing session here is definitive: the user must sign
  // in again. Send them back through /api/gmail/connect afterwards so one
  // click resumes the flow, and never attribute Gmail to an unknown owner.
  const userId = await authenticatedUserId();
  if (!userId) {
    console.warn("[gmail-callback] no authenticated RemoteJobOS session");
    return withClearedStateCookie(
      NextResponse.redirect(
        new URL("/login?next=/api/gmail/connect", publicBaseUrl(request)),
        302
      )
    );
  }
  console.info("[gmail-callback] authenticated RemoteJobOS user resolved", {
    userId
  });

  const returnedError = request.nextUrl.searchParams.get("error");
  if (returnedError) {
    console.warn("[gmail-callback] Google authorization not completed", {
      userId,
      error: returnedError
    });
    await recordConnectionError(
      userId,
      "Google authorization was not completed. Please reconnect Gmail."
    );
    return redirectWithError(request, "Google authorization was not completed.");
  }

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState =
    request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value ?? "";

  if (!code) {
    console.warn("[gmail-callback] missing authorization code", { userId });
    return redirectWithError(
      request,
      "Google did not return an authorization code. Please try connecting again."
    );
  }

  if (!state || !expectedState || !safeStateEqual(expectedState, state)) {
    console.warn("[gmail-callback] OAuth state mismatch", {
      userId,
      hasState: Boolean(state),
      hasStateCookie: Boolean(expectedState)
    });
    return redirectWithError(request, "Invalid or expired Gmail OAuth state.");
  }
  console.info("[gmail-callback] state verified", { userId });

  const env = gmailOAuthEnv();
  if (!env.configured) {
    console.error("[gmail-callback] OAuth environment incomplete", {
      userId,
      hasClientId: Boolean(env.clientId),
      hasClientSecret: Boolean(env.clientSecret),
      hasEncryptionKey: Boolean(env.encryptionKey),
      hasRedirectUri: Boolean(env.redirectUri)
    });
    return redirectWithError(
      request,
      "Gmail OAuth environment is not configured on the server."
    );
  }
  if (!serverSupabaseEnv().configured) {
    console.error("[gmail-callback] Supabase server environment incomplete", {
      userId
    });
    return redirectWithError(
      request,
      "Gmail connection storage is not configured on the server."
    );
  }

  // redirectUri is guaranteed present when configured. It must be
  // byte-identical to the authorization request value — the public callback
  // URL, never Render's internal request host.
  const redirectUri = env.redirectUri;
  console.info("[gmail-callback] OAuth environment available", {
    userId,
    redirectUri
  });

  console.info("[gmail-callback] token exchange attempted", { userId });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });

  const tokens = (await tokenResponse.json().catch(() => ({}))) as TokenResponse;
  if (!tokenResponse.ok || !tokens.access_token) {
    // Safe diagnostics only: status + Google error name/description, no secrets.
    console.error("[gmail-callback] token exchange failed", {
      userId,
      status: tokenResponse.status,
      error: tokens.error ?? null,
      description: tokens.error_description ?? null,
      redirectUri
    });
    await recordConnectionError(
      userId,
      tokens.error_description ?? tokens.error ?? "Google token exchange failed."
    );
    return redirectWithError(
      request,
      tokens.error_description ?? tokens.error ?? "Google token exchange failed."
    );
  }
  console.info("[gmail-callback] token exchange successful", { userId });

  const admin = createAdminSupabaseClient();

  // Google only returns a refresh token when offline consent is granted. On
  // reconnects without a new refresh token, reuse the stored encrypted token
  // so a valid connection is never wiped by a null value.
  let ciphertext: string;
  let iv: string;
  let tag: string;
  if (tokens.refresh_token) {
    console.info("[gmail-callback] refresh token received", { userId });
    let encrypted;
    try {
      encrypted = encryptGmailRefreshToken(tokens.refresh_token);
    } catch (error) {
      console.error("[gmail-callback] token encryption failed", {
        userId,
        message: error instanceof Error ? error.message : String(error)
      });
      await recordConnectionError(
        userId,
        "Gmail token encryption failed. Check GMAIL_TOKEN_ENCRYPTION_KEY on Render."
      );
      return redirectWithError(
        request,
        "Gmail token encryption failed. Check GMAIL_TOKEN_ENCRYPTION_KEY on Render."
      );
    }
    console.info("[gmail-callback] refresh token encrypted", { userId });
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;
    tag = encrypted.tag;
  } else {
    console.warn("[gmail-callback] no refresh token in token response", {
      userId
    });
    const { data: existing, error: existingError } = await admin
      .from("gmail_connections")
      .select("refresh_token_ciphertext,token_iv,token_tag,email_address,granted_scope")
      .eq("owner_id", userId)
      .maybeSingle();
    if (
      existingError ||
      !existing?.refresh_token_ciphertext ||
      !existing?.token_iv ||
      !existing?.token_tag
    ) {
      console.error("[gmail-callback] missing refresh token with no stored token", {
        userId
      });
      await recordConnectionError(
        userId,
        "Google did not return an offline refresh token. Reconnect and grant consent again."
      );
      return redirectWithError(
        request,
        "Google did not return an offline refresh token. Reconnect and grant consent again."
      );
    }
    console.info("[gmail-callback] reusing stored refresh token", { userId });
    ciphertext = existing.refresh_token_ciphertext as string;
    iv = existing.token_iv as string;
    tag = existing.token_tag as string;
  }

  const gmailProfileResponse = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: {
        authorization: "Bearer " + tokens.access_token
      }
    }
  );

  if (!gmailProfileResponse.ok) {
    const profileError = await gmailProfileResponse
      .json()
      .catch(() => null) as { error?: { message?: string } } | null;
    console.error("[gmail-callback] Gmail profile lookup failed", {
      userId,
      status: gmailProfileResponse.status,
      message: profileError?.error?.message ?? null
    });
    await recordConnectionError(
      userId,
      "Could not read the connected Gmail profile. Please reconnect."
    );
    return redirectWithError(request, "Could not read the connected Gmail profile.");
  }

  const gmailProfile = (await gmailProfileResponse.json()) as GmailProfile;
  const emailAddress = gmailProfile.emailAddress ?? null;
  console.info("[gmail-callback] Gmail profile loaded", {
    userId,
    emailAddress
  });

  const grantedScope = tokens.scope ?? DEFAULT_GRANTED_SCOPE;

  // Service-role write bound to the server-verified session user. RLS stays
  // enabled for browser reads; the callback never depends on the
  // authenticated role's grants, so policy drift cannot silently drop rows.
  console.info("[gmail-callback] connection save attempted", { userId });
  const { error: upsertError } = await admin.from("gmail_connections").upsert(
    {
      owner_id: userId,
      email_address: emailAddress,
      refresh_token_ciphertext: ciphertext,
      token_iv: iv,
      token_tag: tag,
      granted_scope: grantedScope,
      active: true,
      last_error: null,
      updated_at: new Date().toISOString()
    },
    { onConflict: "owner_id" }
  );

  if (upsertError) {
    console.error("[gmail-callback] connection save failed", {
      userId,
      code: upsertError.code ?? null,
      message: upsertError.message
    });
    await recordConnectionError(userId, upsertError.message);
    return redirectWithError(request, upsertError.message);
  }

  // Verify the row actually exists instead of assuming the upsert worked.
  const { data: saved, error: verifyError } = await admin
    .from("gmail_connections")
    .select("owner_id,email_address,granted_scope,active")
    .eq("owner_id", userId)
    .maybeSingle();

  if (verifyError || !saved) {
    console.error("[gmail-callback] connection verification failed", {
      userId,
      message: verifyError?.message ?? "row missing after upsert"
    });
    await recordConnectionError(
      userId,
      "Gmail authorization succeeded but the connection was not stored. Please reconnect."
    );
    return redirectWithError(
      request,
      "Gmail authorization succeeded but the connection was not stored. Please reconnect."
    );
  }

  console.info("[gmail-callback] connection saved", {
    userId,
    emailAddress: (saved as { email_address?: string | null }).email_address ?? null,
    grantedScope
  });

  return withClearedStateCookie(
    NextResponse.redirect(
      new URL("/inbox?connected=1", publicBaseUrl(request)),
      302
    )
  );
}
