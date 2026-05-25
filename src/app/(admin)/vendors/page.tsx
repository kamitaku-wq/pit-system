import Link from "next/link";

type AdminVendorsPageProps = {
  searchParams: Promise<{
    invited?: string;
  }>;
};

export default async function AdminVendorsPage({ searchParams }: AdminVendorsPageProps) {
  const params = await searchParams;
  const invited = params.invited === "ok";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">業者一覧</h2>
        <p className="text-sm text-gray-600">業者ユーザーの招待と管理を行います。</p>
      </div>

      {invited ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          業者ユーザーへの招待を送信しました。
        </div>
      ) : null}

      <div>
        <Link
          className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          href="/admin/vendors/invite"
        >
          業者ユーザーを招待
        </Link>
      </div>
    </div>
  );
}
