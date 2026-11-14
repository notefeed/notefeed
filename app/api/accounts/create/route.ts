import { accountCreateRoute } from "@/backend";

export const dynamic = "force-dynamic";

// See backend/http/accounts.ts.
export const POST = (req: Request) => accountCreateRoute(req);
