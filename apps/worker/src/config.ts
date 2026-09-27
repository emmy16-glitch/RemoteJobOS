export const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  dryRun: (process.env.REMOTEJOBOS_DRY_RUN ?? "true").toLowerCase() !== "false",
  enrichmentProvider: (process.env.ENRICHMENT_PROVIDER ?? "none").toLowerCase(),
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"
};

export function hasSupabase() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function hasOptionalEnrichment() {
  return config.enrichmentProvider !== "none";
}
