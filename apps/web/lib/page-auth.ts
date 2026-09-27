import { redirect } from "next/navigation";
import { authenticatedUserId } from "./auth";
import { publicSupabaseEnv, serverSupabaseEnv } from "./supabase/env";

export function dashboardConfigured(): boolean {
  return publicSupabaseEnv().configured && serverSupabaseEnv().configured;
}

export async function requireDashboardUser(next = "/"): Promise<string> {
  if (!dashboardConfigured()) redirect("/");
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login?next=" + encodeURIComponent(next));
  return userId;
}
