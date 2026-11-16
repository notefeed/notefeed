import { operatorAccountCreateRoute, operatorAccountDeleteRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator's accounts: create one (its number and key, once) or delete one by its number; see backend/http/operator.ts.
export const POST = (req: Request) => operatorAccountCreateRoute(req);
export const DELETE = (req: Request) => operatorAccountDeleteRoute(req);
