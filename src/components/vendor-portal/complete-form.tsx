"use client";

import { Loader2 } from "lucide-react";
import { useId } from "react";
import { useFormStatus } from "react-dom";

import { completeAction } from "@/app/(vendor-portal)/vendor/requests/[id]/actions";
import { Button } from "@/components/ui/button";

interface CompleteFormProps {
  invitationId: string;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  returnedAt: Date | null;
}

// Date を datetime-local の value 形式 (YYYY-MM-DDTHH:mm, ローカル時刻) に変換する。
function toLocalInputValue(value: Date | null): string {
  if (!value) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full sm:w-auto" disabled={pending} type="submit">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      <span>{children}</span>
    </Button>
  );
}

export function CompleteForm({
  invitationId,
  pickedUpAt,
  deliveredAt,
  returnedAt,
}: CompleteFormProps) {
  const baseId = useId();
  const fields: { name: string; label: string; defaultValue: string }[] = [
    { name: "pickedUpAt", label: "引取完了日時", defaultValue: toLocalInputValue(pickedUpAt) },
    { name: "deliveredAt", label: "搬入完了日時", defaultValue: toLocalInputValue(deliveredAt) },
    { name: "returnedAt", label: "返却完了日時", defaultValue: toLocalInputValue(returnedAt) },
  ];

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="space-y-4">
        <div>
          <h2 id={`${baseId}-heading`} className="text-base font-semibold tracking-normal">
            完了報告
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            引取・搬入・返却の実績日時を入力して完了報告してください。完了報告すると案件ステータスが「完了」になります。
          </p>
        </div>

        <form action={completeAction} className="space-y-4">
          <input name="invitationId" type="hidden" value={invitationId} />
          <div className="grid gap-4 sm:grid-cols-3">
            {fields.map((field) => (
              <div key={field.name}>
                <label
                  className="block text-xs font-medium text-gray-500"
                  htmlFor={`${baseId}-${field.name}`}
                >
                  {field.label}
                </label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
                  defaultValue={field.defaultValue}
                  id={`${baseId}-${field.name}`}
                  name={field.name}
                  type="datetime-local"
                />
              </div>
            ))}
          </div>
          <SubmitButton>完了報告する</SubmitButton>
        </form>
      </div>
    </section>
  );
}
