import { signIn, signUp } from "../auth-actions";
import { publicSupabaseEnv } from "../../lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{
    error?: string;
    next?: string;
    mode?: string;
    created?: string;
    email?: string;
  }>;
}) {
  const params = await searchParams;
  const configured = publicSupabaseEnv().configured;
  const signup = params.mode === "signup";

  return (
    <main className="loginShell">
      <section className="loginCard loginCardV2">
        <div className="loginBrand">
          <div className="brandMark" aria-hidden="true">
            <span className="brandHandle" />
            <span className="brandCase" />
          </div>
          <div>
            <b>RemoteJobOS</b>
            <span>Find. Apply. Get Hired. Automatically.</span>
          </div>
        </div>

        <div className="loginCopy">
          <p className="eyebrow">{signup ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</p>
          <h1>{signup ? "Start RemoteJobOS" : "Sign in"}</h1>
          <p>
            {signup
              ? "Create your private control-room account. Your prepared career profile will attach automatically when the email matches."
              : "Open your private dashboard to monitor applications, exceptions, CVs and employer responses."}
          </p>
        </div>

        {!configured ? (
          <div className="loginAlert">
            Supabase Auth is not configured in this deployment yet.
          </div>
        ) : null}

        {params.created ? (
          <div className="loginAlert success">
            Account created. Check your email if Supabase asks you to confirm it,
            then sign in.
          </div>
        ) : null}

        {params.error ? (
          <div className="loginAlert error">{params.error}</div>
        ) : null}

        <div className="authSwitch" aria-label="Authentication mode">
          <a className={!signup ? "active" : ""} href={"/login?next=" + encodeURIComponent(params.next ?? "/")}>
            Sign in
          </a>
          <a
            className={signup ? "active" : ""}
            href={"/login?mode=signup&next=" + encodeURIComponent(params.next ?? "/")}
          >
            Create account
          </a>
        </div>

        <form action={signup ? signUp : signIn} className="loginForm">
          <input type="hidden" name="next" value={params.next ?? "/"} />

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={!configured}
              defaultValue={params.email ?? ""}
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              required
              disabled={!configured}
              placeholder={signup ? "8+ characters" : "Your password"}
            />
          </label>

          {signup ? (
            <label>
              <span>Confirm password</span>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                disabled={!configured}
                placeholder="Repeat your password"
              />
            </label>
          ) : null}

          <button type="submit" disabled={!configured}>
            {signup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="loginFoot">
          Private by default. RemoteJobOS never exposes server credentials in the browser.
        </p>
      </section>
    </main>
  );
}
