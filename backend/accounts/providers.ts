// The operator's OIDC providers (backend/oidc/config.ts) as Better Auth's generic OAuth providers.
import { genericOAuth } from "better-auth/plugins";

export const genericOAuthPlugin = () => genericOAuth({ config: [] });
