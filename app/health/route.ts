import { healthRoute } from "@/backend";

export const dynamic = "force-dynamic";

// Probed by Docker, a reverse proxy or an uptime monitor; see backend/http/health.ts. Reserved as a feed name (backend/feednames.ts).
export const GET = () => healthRoute();
