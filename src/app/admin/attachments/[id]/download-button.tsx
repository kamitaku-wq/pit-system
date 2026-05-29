"use client";

import { useState } from "react";
import {
  type IssueAttachmentDownloadUrlResult,
  issueAttachmentDownloadUrlAction,
} from "./actions";

// signed URL は on-demand 発行 (click 時に server action POST) し、SSR HTML には埋め込まない。
// 取得した短命 URL は新規タブで開くのみで DOM には残さない。

function reasonLabel(
  reason: Extract<IssueAttachmentDownloadUrlResult, { ok: false }>["reason"],
): string {
  switch (reason) {
    case "not_found":
      return "ファイルが見つかりません (失効済みの可能性があります)。";
    case "invalid_storage_path":
      return "保存先の参照が不正です。管理者にお問い合わせください。";
    case "storage_unavailable":
      return "ストレージ連携が未設定です。";
    case "sign_failed":
      return "ダウンロード URL の発行に失敗しました。時間をおいて再試行してください。";
    default:
      return "ダウンロード URL の発行に失敗しました。";
  }
}

export function AttachmentDownloadButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await issueAttachmentDownloadUrlAction(id);
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        setError(reasonLabel(res.reason));
      }
    } catch {
      setError("ダウンロード URL の発行に失敗しました。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="inline-flex w-fit items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "URL 発行中…" : "ダウンロード URL を発行 (5 分有効)"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
