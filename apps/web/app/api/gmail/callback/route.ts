import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authenticatedUserId } from "../../../../lib/auth";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { encryptGmailRefreshToken } from "../../../../lib/gmail/crypto";
import { gmailOAuthEnv } from "../../../../lib/gmail/env";

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

function redirectWithError(request: NextRequest, message: string) {
  return NextResponse.redirect(
    new URL(
      "/inbox?error=" + encodeURIComponent(message),
      publicBaseUrl(request)
    ),
    302
  );
}

export async function GET(request: NextRequest) {
  console.info("[gmail-callback] received", {
    host: request.nextUrl.host,
    hasCode: Boolean(request.nextUrl.searchParams.get("code")),
    hasState: Boolean(request.nextUrl.searchParams.get("state")),
    hasStateCookie: Boolean(request.cookies.get("remotejobos_gmail_oauth_state")?.value)
  });

  const userId = await authenticatedUserId();
  if (!userId) {
    console.warn("[gmail-callback] no authenticated RemoteJobOS session");
    return NextResponse.redirect(new URL("/login?next=/inbox", publicBaseUrl(request)), 302);
  }

  const returnedError = request.nextUrl.searchParams.get("error");
  if (returnedError) {
    return redirectWithError(request, "Google authorization was not completed.");
  }

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState =
    request.cookies.get("remotejobos_gmail_oauth_state")?.value ?? "";

  if (!code || !state || !expectedState || !safeStateEqual(expectedState, state)) {
    return redirectWithError(request, "Invalid or expired Gmail OAuth state.");
  }

  const env = gmailOAuthEnv();
  if (!env.configured) {
    return redirectWithError(request, "Gmail OAuth environment is not configured.");
  }

  const redirectUri =
    env.redirectUri || new URL("/api/gmail/callback", request.url).toString();

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

  const tokens = (await tokenResponse.json()) as TokenResponse;
  if (!tokenResponse.ok || !tokens.access_token) {
    console.error("[gmail-callback] token exchange failed", {
      status: tokenResponse.status,
      error: tokens.error ?? null,
      description: tokens.error_description ?? null
    });
    return redirectWithError(
      request,
      tokens.error_description ?? tokens.error ?? "Google token exchange failed."
    );
  }

  if (!tokens.refresh_token) {
    return redirectWithError(
      request,
      "Google did not return an offline refresh token. Reconnect and grant consent again."
    );
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
    console.error("[gmail-callback] Gmail profile lookup failed", {
      status: gmailProfileResponse.status
    });
    return redirectWithError(request, "Could not read the connected Gmail profile.");
  }

  const gmailProfile = (await gmailProfileResponse.json()) as GmailProfile;
  let encrypted;
  try {
    encrypted = encryptGmailRefreshToken(tokens.refresh_token);
  } catch (error) {
    console.error("[gmail-callback] token encryption failed", error);
    return redirectWithError(
      request,
      "Gmail token encryption failed. Check GMAIL_TOKEN_ENCRYPTION_KEY on Render."
    );
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("gmail_connections")
    .upsert(
      {
        owner_id: userId,
        email_address: gmailProfile.emailAddress ?? null,
        refresh_token_ciphertext: encrypted.ciphertext,
        token_iv: encrypted.iv,
        token_tag: encrypted.tag,
        granted_scope:
          tokens.scope ??
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        active: true,
        last_error: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "owner_id" }
    )
    .select("owner_id")
    .maybeSingle();

  if (error) {
    console.error("[gmail-callback] connection save failed", {
      code: error.code ?? null,
      message: error.message
    });
    return redirectWithError(request, error.message);
  }

  console.info("[gmail-callback] Gmail connected", {
    userId,
    emailAddress: gmailProfile.emailAddress ?? null,
    grantedScope: tokens.scope ?? null
  });

  const response = NextResponse.redirect(
    new URL("/inbox?connected=1", publicBaseUrl(request)),
    302
  );
  response.cookies.delete("remotejobos_gmail_oauth_state");
  return response;
}
