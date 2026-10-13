import { attachRoute } from "@/backend";

export const dynamic = "force-dynamic";

// Put a license on a feed, or take it off; see backend/http/licenses.ts.
export const POST = (req: Request) => attachRoute(req);
export const DELETE = (req: Request) => attachRoute(req);
