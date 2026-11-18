import { authServerRoute, metadataPreflight } from "@/backend";

// RFC 8414 for an issuer with a path: Better Auth's, PUBLIC_URL/api/auth, where there are accounts (ADR 0062).
export const dynamic = "force-dynamic";

export const GET = authServerRoute;
export const OPTIONS = metadataPreflight;
