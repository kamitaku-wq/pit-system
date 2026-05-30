import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { companySettings } from "@/lib/db/schema/company_settings";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";
import { normalizeEmailDomain } from "@/lib/auth/email-domain";

// Phase 66: Google ログイン callback での社内ユーザー provisioning + 許可ドメインゲート。
//
// 設計 (一社専用シンプル方式、spec phase-66 plan):
//   - 許可ドメイン → 会社 の解決は **既存 company_settings テーブル** を使う (新規 table/migration なし)。
//     key='allowed_email_domain'、value(jsonb) = 許可ドメイン配列 (例 ["kaisha.co.jp"])。
//     その配列に email ドメインを含む会社が「その社員の所属会社」。一社運用では 1 行。
//     (将来複数社にしてもこの仕組みのまま会社ごとに 1 行足すだけで拡張できる = 退路を断たない)
//   - ドメイン不一致 → 拒否 (fail-closed)。これが「会社 Google アカウント以外を入口で締め出す」核。
//   - 初回ログインは最低権限 'viewer' で provisioning。管理者が後で role/店舗を付与する (delively_flow の GUEST と同思想)。
//   - 無効化/削除済みユーザー (退職者) は拒否。
//
// 実行接続: 認証直後で RLS の current_user_company_id() が未確立のため service_role/owner db
//   (@/lib/db/client) で呼ぶ (ADR-0010 の pre-auth service_role 境界に「Google callback provisioning」を追加)。

// Drizzle は DB と PgTransaction を共通で表す型を export しないため any を許容する (既存 service と同方針)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ProvisionInternalUserInput = {
  authUserId: string;
  email: string | null | undefined;
  displayName?: string | null;
};

export type ProvisionInternalUserResult =
  | { ok: true; companyId: string; userId: string; isNew: boolean }
  // domain_not_allowed: email ドメインがどの会社の許可リストにも一致しない (= 入口拒否)。
  | { ok: false; reason: "domain_not_allowed" }
  // user_disabled: 既存ユーザーが is_active=false または論理削除済み (退職者等)。
  | { ok: false; reason: "user_disabled" }
  // no_viewer_role: 初期 role 'viewer' が見つからない (seed 不全。通常起きない)。
  | { ok: false; reason: "no_viewer_role" };

// company_settings.value (jsonb) から許可ドメイン配列を取り出す。配列/文字列の両形を許容。
function extractDomains(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    // カンマ区切り文字列も許容 ("a.co.jp,b.co.jp")。
    return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [];
}

export async function provisionInternalUserByEmail(
  db: Db,
  input: ProvisionInternalUserInput,
): Promise<ProvisionInternalUserResult> {
  const domain = normalizeEmailDomain(input.email);
  if (domain === null) {
    return { ok: false, reason: "domain_not_allowed" };
  }
  const email = String(input.email).trim().toLowerCase();
  const displayName = (input.displayName?.trim() || email.split("@")[0] || "ユーザー").slice(0, 200);

  return db.transaction(async (tx: Db): Promise<ProvisionInternalUserResult> => {
    // 1) 許可ドメイン → 会社 の解決 (company_settings.allowed_email_domain にドメインを含む会社)。
    const settingRows = await tx
      .select({ companyId: companySettings.companyId, value: companySettings.value })
      .from(companySettings)
      .where(eq(companySettings.key, "allowed_email_domain"));

    let resolvedCompanyId: string | null = null;
    for (const row of settingRows) {
      const domains = extractDomains(row.value).map((d) => d.toLowerCase().replace(/^@/, ""));
      if (domains.includes(domain)) {
        resolvedCompanyId = row.companyId;
        break;
      }
    }
    if (resolvedCompanyId === null) {
      return { ok: false, reason: "domain_not_allowed" };
    }

    // 2) 既存ユーザー (auth uid 一致) の get-or-create。
    const existingRows = await tx
      .select({
        id: users.id,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, input.authUserId))
      .limit(1);
    const existing = existingRows[0];

    if (existing) {
      // 退職者・無効化済みは拒否 (fail-closed)。
      if (!existing.isActive || existing.deletedAt !== null) {
        return { ok: false, reason: "user_disabled" };
      }
      await tx
        .update(users)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, input.authUserId));
      return { ok: true, companyId: resolvedCompanyId, userId: existing.id, isNew: false };
    }

    // 3) 新規 provisioning: 最低権限 'viewer' (global role) で作成。
    const viewerRows = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.code, "viewer"), isNull(roles.companyId)))
      .limit(1);
    const viewerRole = viewerRows[0];
    if (!viewerRole) {
      return { ok: false, reason: "no_viewer_role" };
    }

    await tx.insert(users).values({
      id: input.authUserId,
      companyId: resolvedCompanyId,
      roleId: viewerRole.id,
      email,
      name: displayName,
      isActive: true,
      lastLoginAt: new Date(),
    });

    return { ok: true, companyId: resolvedCompanyId, userId: input.authUserId, isNew: true };
  });
}
