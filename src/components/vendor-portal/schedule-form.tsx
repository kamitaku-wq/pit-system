"use client";

import { Loader2 } from "lucide-react";
import { useId } from "react";
import { useFormStatus } from "react-dom";

import { scheduleAction } from "@/app/(vendor-portal)/vendor/requests/[id]/actions";
import { Button } from "@/components/ui/button";

interface ScheduleFormProps {
  invitationId: string;
  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;
  scheduledReturnAt: Date | null;
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

export function ScheduleForm({
  invitationId,
  scheduledPickupAt,
  scheduledDeliveryAt,
  scheduledReturnAt,
}: ScheduleFormProps) {
  const baseId = useId();
  const fields: { name: string; label: string; defaultValue: string }[] = [
    {
      name: "scheduledPickupAt",
      label: "引取予定日時",
      defaultValue: toLocalInputValue(scheduledPickupAt),
    },
    {
      name: "scheduledDeliveryAt",
      label: "搬入予定日時",
      defaultValue: toLocalInputValue(scheduledDeliveryAt),
    },
    {
      name: "scheduledReturnAt",
      label: "返却予定日時",
      defaultValue: toLocalInputValue(scheduledReturnAt),
    },
  ];

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="space-y-4">
        <div>
          <h2 id={`${baseId}-heading`} className="text-base font-semibold tracking-normal">
            予定入力
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            引取・搬入・返却の予定日時を入力してください (任意・後から変更可)。
          </p>
        </div>

        <form action={scheduleAction} className="space-y-4">
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
          <SubmitButton>予定を保存</SubmitButton>
        </form>
      </div>
    </section>
  );
}
