import { operatorFeedDeleteRoute, operatorFeedOwnerRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator's feeds: give one to an account or take its owner away, or delete one; see backend/http/operator.ts.
export const PUT = (req: Request) => operatorFeedOwnerRoute(req);
export const DELETE = (req: Request) => operatorFeedDeleteRoute(req);
