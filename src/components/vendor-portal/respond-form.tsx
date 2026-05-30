"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { respondAction } from "@/app/(vendor-portal)/vendor/requests/[id]/actions";
import { Button } from "@/components/ui/button";

interface RespondFormProps {
  invitationId: string;
  transportOrderId: string;
  actionError?: string;
}

type SubmitButtonProps = {
  children: string;
  disabled: boolean;
  variant?: "default" | "destructive";
};

function SubmitButton({ children, disabled, variant = "default" }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const isPending = disabled || pending;

  return (
    <Button className="w-full" disabled={isPending} type="submit" variant={variant}>
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      <span>{children}</span>
    </Button>
  );
}

export function RespondForm({ invitationId, transportOrderId, actionError }: RespondFormProps) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <section
      aria-labelledby={`${reasonId}-heading`}
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      data-transport-order-id={transportOrderId}
    >
      <div className="space-y-4">
        <div>
          <h2 id={`${reasonId}-heading`} className="text-base font-semibold tracking-normal">
            回答
          </h2>
          <p className="mt-1 text-sm text-gray-500">依頼内容を確認して回答してください。</p>
        </div>

        {actionError ? <p className="text-sm font-medium text-red-600">{actionError}</p> : null}

        <div>
          <label className="sr-only" htmlFor={reasonId}>
            拒否理由
          </label>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
            id={reasonId}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="拒否理由 (任意・最大500文字)"
            value={reason}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <form action={respondAction} onSubmit={() => setIsSubmitting(true)}>
            <input name="invitationId" type="hidden" value={invitationId} />
            <input name="response" type="hidden" value="accepted" />
            <input name="reason" type="hidden" value={reason} />
            <SubmitButton disabled={isSubmitting}>承諾</SubmitButton>
          </form>

          <form action={respondAction} onSubmit={() => setIsSubmitting(true)}>
            <input name="invitationId" type="hidden" value={invitationId} />
            <input name="response" type="hidden" value="rejected" />
            <input name="reason" type="hidden" value={reason} />
            <SubmitButton disabled={isSubmitting} variant="destructive">
              辞退
            </SubmitButton>
          </form>
        </div>
      </div>
    </section>
  );
}
