import { feedLicenseRoute } from "@/backend";

// The feed's settings page enters or removes a license key here, under the feed's path, where a protected feed's unlock
// cookie is sent; see backend/http/licenses.ts. A static segment, so it wins over [id].
export async function POST(req: Request, { params }: RouteContext<"/[feed]/license">) {
  return feedLicenseRoute(req, (await params).feed);
}

export async function DELETE(req: Request, { params }: RouteContext<"/[feed]/license">) {
  return feedLicenseRoute(req, (await params).feed);
}
