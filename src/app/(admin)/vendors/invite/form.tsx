"use client";

import { useActionState } from "react";

import {
  inviteVendorAction,
  type InviteVendorActionState,
} from "./actions";

type VendorOption = {
  id: string;
  name: string;
  email: string | null;
};

type InviteVendorFormProps = {
  vendors: VendorOption[];
};

const initialInviteVendorActionState: InviteVendorActionState = {
  error: null,
  values: {
    vendorId: "",
    name: "",
    email: "",
    role: "vendor_admin",
  },
};

export function InviteVendorForm({ vendors }: InviteVendorFormProps) {
  const [state, formAction, isPending] = useActionState<InviteVendorActionState, FormData>(
    inviteVendorAction,
    initialInviteVendorActionState,
  );

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-5">
      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="vendorId">
          業者
        </label>
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
          defaultValue={state.values.vendorId}
          disabled={isPending || vendors.length === 0}
          id="vendorId"
          name="vendorId"
          required
        >
          <option value="">業者を選択</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.email ? `${vendor.name} (${vendor.email})` : vendor.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="name">
          氏名
        </label>
        <input
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          defaultValue={state.values.name}
          id="name"
          maxLength={100}
          name="name"
          type="text"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="email">
          メールアドレス
        </label>
        <input
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          defaultValue={state.values.email}
          id="email"
          name="email"
          required
          type="email"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="role">
          権限
        </label>
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          defaultValue={state.values.role}
          id="role"
          name="role"
          required
        >
          <option value="vendor_admin">業者管理者</option>
          <option value="vendor_member">業者メンバー</option>
        </select>
      </div>

      <div>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          disabled={isPending || vendors.length === 0}
          type="submit"
        >
          {isPending ? "送信中..." : "招待を送信"}
        </button>
      </div>
    </form>
  );
}
