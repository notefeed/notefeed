import { resealRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator's encryption of the notes stored before encryption was turned on; see backend/http/operator.ts.
export const POST = (req: Request) => resealRoute(req);
