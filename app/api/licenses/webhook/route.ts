import { webhookRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The payment provider's events; see backend/http/licenses.ts.
export const POST = (req: Request) => webhookRoute(req);
