"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  type AttachmentSignedUrlReason,
  issueAttachmentSignedUrl,
} from "@/lib/services/attachment-download";
import { softDeleteAttachment } from "@/lib/services/attachments";

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Invalid ${name}`);
  return trimmed;
}

export async function softDeleteAttachmentAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredString(formData, "id");

  await softDeleteAttachment(id, { db, companyId: adminUser.companyId });
  revalidatePath(`/admin/attachments/${id}`);
  revalidatePath("/admin/attachments");
  redirect("/admin/attachments");
}

export type IssueAttachmentDownloadUrlResult =
  | { ok: true; url: string; expiresInSeconds: number; fileName: string }
  | { ok: false; reason: AttachmentSignedUrlReason };

// signed URL は on-demand (本 action 経由) で発行し SSR HTML には埋め込まない (短命 URL の leak 回避)。
export async function issueAttachmentDownloadUrlAction(
  id: string,
): Promise<IssueAttachmentDownloadUrlResult> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, reason: "not_found" };

  const result = await issueAttachmentSignedUrl(parsed.data, {
    db,
    companyId: adminUser.companyId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    url: result.url,
    expiresInSeconds: result.expiresInSeconds,
    fileName: result.fileName,
  };
}
