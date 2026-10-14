import { portalRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The payment provider's page for the holder of a license key; see backend/http/licenses.ts.
export const POST = (req: Request) => portalRoute(req);
