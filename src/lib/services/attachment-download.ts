/**
 * attachment download (signed URL) service — Phase 64-A.28
 *
 * a26-b 確定設計の実装フェーズ。spec/data-model.md §12.1 / requirements 添付運用に対応。
 *
 * 設計判断 (a26-b + advisor #1 gate 反映):
 * 1. 全社 1 private bucket + path prefix `{company_id}/{entity}/{entity_id}/{attachment_id}`。
 *    直接アクセスは全 deny、service_role の signed URL 発行 (TTL 5 分) のみが唯一の read 経路。
 * 2. ownership gate: getAttachmentById(id, ctx) が WHERE company_id = ctx.companyId で
 *    cross-tenant を 1 次防御 (A.22 canonical)。getAttachmentById は deleted_at を filter しないため、
 *    本関数の `deletedAt !== null → not_found` チェックは load-bearing (冗長ではない)。
 * 3. defense-in-depth (単一 bucket = service 層 ownership バグが cross-tenant read 直結のリスク):
 *    row.storageBucket が canonical bucket と一致し、storageKey が `{companyId}/` prefix 配下で、
 *    path traversal (`..` / leading `/`) を含まないことを署名前に厳格検証。違反は corruption /
 *    cross-tenant 試行のシグナルなので server-side に console.error で記録 (PII は出さず構造的事実のみ)、
 *    client には generic `invalid_storage_path` を返す。
 * 4. signed URL は **on-demand (server action POST)** で発行し SSR HTML には埋め込まない
 *    (短命 URL が prefetch/unfurl/log/cache に焼かれる leak を回避)。
 * 5. signer 注入可能 (テスト容易性): 既定は service_role admin storage client。Supabase 実体なしで
 *    gate ロジックを単体検証できる。注入 fake signer は gate を証明するが「Supabase が実際に署名する」
 *    ことは bucket 実在時のみ検証される (handoff の bucket 作成コマンド)。
 * 6. **audit 意図的 deferral**: signed URL 発行は PII (顧客名/電話/車両/書類) を露出するが本 phase は
 *    監査ログを残さない。A.24 detail read と同じ rationale — audit_logs.action CHECK は
 *    ('create','update','delete','restore') 限定で純粋な read 発行が map しない。閲覧監査が
 *    要件化されたら after_json.kind 命名拡張で別 phase 対応。
 * 7. bucket 名 SSOT: a26 が「Phase 4 統合で確定」と deferred していた bucket 値を本 phase で
 *    `attachments` に確定。service の check と handoff の bucket 作成コマンドが同一定数を参照する
 *    (drift すると全 download が失敗するため SSOT 化)。env `ATTACHMENTS_STORAGE_BUCKET` で上書き可。
 * 8. storageKey SSOT builder (buildAttachmentStorageKey): download は `{companyId}/` prefix を read で
 *    強制するが、register 側 (本 phase で不改修=411-test invariant 維持) は prefix を強制しない。
 *    Phase 4 の upload helper は必ず本 builder で key を組むこと (さもなくば全 download が
 *    invalid_storage_path で silent fail)。loud invariant として handoff に記載。
 */

import { getConfiguredSupabaseAdmin } from "@/lib/supabase/admin";
import {
  type AttachmentContext,
  getAttachmentById,
  type ParentType,
} from "./attachments";

// ---------------------------------------------------------------------------
// canonical storage constants (SSOT)
// ---------------------------------------------------------------------------

// a26 deferred → A.28 で確定。handoff の bucket 作成コマンドと verbatim 一致させること。
export const ATTACHMENTS_BUCKET =
  process.env.ATTACHMENTS_STORAGE_BUCKET?.trim() || "attachments";

// a26-b: signed URL TTL 5 分。
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * storage key の SSOT builder。
 * Phase 4 upload helper は必ずこれで key を生成すること
 * (download は `{companyId}/` prefix を強制するため)。
 */
export function buildAttachmentStorageKey(
  companyId: string,
  entity: ParentType,
  entityId: string,
  attachmentId: string,
): string {
  return `${companyId}/${entity}/${entityId}/${attachmentId}`;
}

// ---------------------------------------------------------------------------
// signer abstraction (テスト容易性のため注入可能)
// ---------------------------------------------------------------------------

export type StorageSigner = {
  createSignedUrl(
    bucket: string,
    key: string,
    expiresInSeconds: number,
  ): Promise<{ signedUrl: string } | { error: string }>;
};

function defaultSigner(): StorageSigner | null {
  const admin = getConfiguredSupabaseAdmin();
  if (!admin) return null;
  return {
    async createSignedUrl(bucket, key, expiresInSeconds) {
      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUrl(key, expiresInSeconds);
      if (error || !data?.signedUrl) {
        return { error: error?.message ?? "no signed url returned" };
      }
      return { signedUrl: data.signedUrl };
    },
  };
}

// ---------------------------------------------------------------------------
// result type
// ---------------------------------------------------------------------------

export type AttachmentSignedUrlReason =
  | "not_found"
  | "invalid_storage_path"
  | "storage_unavailable"
  | "sign_failed";

export type AttachmentSignedUrlResult =
  | {
      ok: true;
      url: string;
      expiresInSeconds: number;
      fileName: string;
      contentType: string | null;
    }
  | { ok: false; reason: AttachmentSignedUrlReason };

export type IssueAttachmentSignedUrlOptions = {
  expiresInSeconds?: number;
  // undefined = 既定 signer (service_role)、null = 明示的に未設定 (storage_unavailable)
  signer?: StorageSigner | null;
};

// ---------------------------------------------------------------------------
// issueAttachmentSignedUrl
// ---------------------------------------------------------------------------

export async function issueAttachmentSignedUrl(
  id: string,
  ctx: AttachmentContext,
  options: IssueAttachmentSignedUrlOptions = {},
): Promise<AttachmentSignedUrlResult> {
  // 1. ownership gate (company-scoped)。getAttachmentById は deleted_at を filter しないため
  //    deletedAt チェックは load-bearing。
  const att = await getAttachmentById(id, ctx);
  if (!att || att.deletedAt !== null) {
    return { ok: false, reason: "not_found" };
  }

  // 2. defense-in-depth (単一 bucket cross-tenant 防御)。
  const requiredPrefix = `${ctx.companyId}/`;
  const bucketOk = att.storageBucket === ATTACHMENTS_BUCKET;
  const prefixOk = att.storageKey.startsWith(requiredPrefix);
  const traversalOk =
    !att.storageKey.includes("..") && !att.storageKey.startsWith("/");
  if (!bucketOk || !prefixOk || !traversalOk) {
    // corruption / cross-tenant 試行のシグナル。PII (full key) は出さず構造的事実のみ記録。
    console.error("[attachment-download] storage path defense-in-depth rejection", {
      attachmentId: att.id,
      companyId: ctx.companyId,
      bucketOk,
      prefixOk,
      traversalOk,
    });
    return { ok: false, reason: "invalid_storage_path" };
  }

  // 3. service_role storage client で signed URL 発行 (TTL 5 分)。
  const signer =
    options.signer !== undefined ? options.signer : defaultSigner();
  if (!signer) {
    return { ok: false, reason: "storage_unavailable" };
  }
  const expiresInSeconds = options.expiresInSeconds ?? SIGNED_URL_TTL_SECONDS;
  const signed = await signer.createSignedUrl(
    att.storageBucket,
    att.storageKey,
    expiresInSeconds,
  );
  if ("error" in signed) {
    console.error("[attachment-download] signed URL issuance failed", {
      attachmentId: att.id,
      companyId: ctx.companyId,
      error: signed.error,
    });
    return { ok: false, reason: "sign_failed" };
  }

  return {
    ok: true,
    url: signed.signedUrl,
    expiresInSeconds,
    fileName: att.fileName,
    contentType: att.contentType,
  };
}
