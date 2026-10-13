import { checkoutRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The URL to buy a license at; see backend/http/licenses.ts.
export const POST = (req: Request) => checkoutRoute(req);
