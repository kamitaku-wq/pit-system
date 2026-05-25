import { type SupabaseClient, createClient } from "@supabase/supabase-js";

// Phase 31-B: service_role を使う Supabase admin client の共通生成。
// ADR-0010 補項: 利用範囲は spec/CLAUDE.md §ADR-0010 を参照。
// onboard-action.ts のインライン実装を抽出して、admin invite flow と共有する。
export function getConfiguredSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
