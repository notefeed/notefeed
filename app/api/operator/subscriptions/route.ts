import { operatorSubscriptionsRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator puts a subscription the provider already has on an account; see backend/http/operator.ts.
export const POST = (req: Request) => operatorSubscriptionsRoute(req);
