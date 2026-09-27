import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseEnv } from "./env";

export async function createServerSupabaseClient() {
  const env = publicSupabaseEnv();
  if (!env.configured) {
    throw new Error("Supabase public environment is not configured");
  }

  const cookieStore = await cookies();

  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always mutate cookies. The Next.js proxy
          // refreshes sessions before protected pages render.
        }
      }
    }
  });
}
