import { recoveryKeyRoute } from "@/backend";

export const dynamic = "force-dynamic";

// See backend/http/accounts.ts.
export const POST = (req: Request) => recoveryKeyRoute(req);
