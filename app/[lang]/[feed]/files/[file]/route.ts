import { cookies } from "next/headers";
import { feedCookieName, ownerFileRoute } from "@/backend";

export const dynamic = "force-dynamic";

// A file of the feed for whoever has it unlocked (or on an open feed), drafts' and scheduled notes' pictures too (#349): the feed's own
// pages show pictures from here. A static segment, so it wins over [id]. Readers use the read link, /r/<readId>/<file>.
export async function GET(req: Request, { params }: RouteContext<"/[lang]/[feed]/files/[file]">) {
  const { feed, file } = await params;
  return ownerFileRoute(feed, file, (await cookies()).get(feedCookieName(feed))?.value, req.headers.get("if-none-match"));
}
