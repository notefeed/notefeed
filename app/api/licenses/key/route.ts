import { keyRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The license key bought in a checkout, for the success page; see backend/http/licenses.ts.
export const POST = (req: Request) => keyRoute(req);
