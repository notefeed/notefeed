import { atomRoute } from "@/backend";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: RouteContext<"/r/[readId]/atom.xml">) {
  return atomRoute(req, (await params).readId);
}
