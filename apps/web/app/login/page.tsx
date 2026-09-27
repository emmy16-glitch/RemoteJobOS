import { signIn } from "../auth-actions";
import { publicSupabaseEnv } from "../../lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const configured = publicSupabaseEnv().configured;

  return (
    <main className="loginShell">
      <section className="loginCard">
        <div className="loginBrand">
          <div className="mark">R</div>
          <div>
            <b>RemoteJobOS</b>
            <span>Private control center</span>
          </div>
        </div>

        <div className="loginCopy">
          <p className="eyebrow">SECURE ACCESS</p>
          <h1>Sign in</h1>
          <p>
            Your application history, CVs and agent controls are private.
          </p>
        </div>

        {!configured ? (
          <div className="loginAlert">
            Supabase Auth is not configured yet. Add the project URL and publishable key to the deployment environment.
          </div>
        ) : null}

        {params.error ? (
          <div className="loginAlert error">{params.error}</div>
        ) : null}

        <form action={signIn} className="loginForm">
          <input type="hidden" name="next" value={params.next ?? "/"} />

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={!configured}
            />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={!configured}
            />
          </label>

          <button type="submit" disabled={!configured}>
            Sign in
          </button>
        </form>

        <p className="loginFoot">
          RemoteJobOS does not expose service-role credentials to the browser.
        </p>
      </section>
    </main>
  );
}
