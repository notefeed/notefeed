"use client";
// Better Auth's browser client, for passkeys only (WebAuthn needs the browser): everything else goes through notefeed's own forms
// and routes (backend/http/accounts.ts).
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

let client: ReturnType<typeof make> | undefined;
const make = () => createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth", plugins: [passkeyClient()] });
export const accountClient = () => (client ??= make());
