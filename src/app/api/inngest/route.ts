import { serve } from "inngest/next";
import { inngest, inngestFunctions } from "@/lib/inngest/client";

// Next.js App Router serve handler
// /api/inngest GET / POST / PUT で Inngest CLI / cloud と同期
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});

// Node.js runtime (default) を明示 (Edge は postgres direct を扱えない)
export const runtime = "nodejs";
