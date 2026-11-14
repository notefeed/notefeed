// A real OIDC provider for tests (oauth2-mock-server on loopback): discovery, authorize, token and JWKS. `claims` is what the next
// id_tokens carry besides iss/aud/exp/nonce; `failToken()` makes the next token request fail. Plus a cookie jar and `signIn`, which
// drives a sign-in through every redirect: notefeed's start, the provider's authorize, Better Auth's callback, notefeed's finish.
import { Events, OAuth2Server } from "oauth2-mock-server";
import { authRoute } from "../accounts/auth";
import { oidcFinishRoute, oidcStartRoute } from "./routes";

export const BASE = "http://localhost:3000";

export type MockProvider = { issuer: string; claims: Record<string, unknown>; tokenRequests: { body: Record<string, unknown>; authorization?: string }[]; failToken: () => void; stop: () => Promise<void> };

export async function startProvider(): Promise<MockProvider> {
  const server = new OAuth2Server();
  await server.issuer.keys.generate("RS256");
  await server.start(0, "127.0.0.1");
  const p: MockProvider = {
    issuer: server.issuer.url!,
    claims: {},
    tokenRequests: [],
    failToken: () =>
      server.service.once(Events.BeforeResponse, (res) => {
        res.body = { error: "invalid_grant" };
        res.statusCode = 400;
      }),
    stop: () => server.stop(),
  };
  server.service.on(Events.BeforeResponse, (_res, req) => {
    p.tokenRequests.push({ body: { ...(req.body as Record<string, unknown>) }, authorization: req.headers.authorization });
  });
  server.service.on(Events.BeforeTokenSigning, (token) => {
    for (const [k, v] of Object.entries(p.claims)) if (v === undefined) delete token.payload[k];
    Object.assign(token.payload, Object.fromEntries(Object.entries(p.claims).filter(([, v]) => v !== undefined)));
  });
  return p;
}

// The environment of one provider (the unprefixed one, id `default`, unless `name` is given).
export function providerEnv(p: MockProvider, allow = "*", name = ""): Record<string, string> {
  const pre = name ? `NOTEFEED_OIDC_${name}_` : "NOTEFEED_OIDC_";
  return { [`${pre}ISSUER`]: p.issuer, [`${pre}CLIENT_ID`]: "notefeed", [`${pre}CLIENT_SECRET`]: "secret", [`${pre}ALLOW`]: allow };
}

export class Jar {
  private cookies = new Map<string, string>();
  take(res: Response): Response {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const [name, value] = [pair.slice(0, i).trim(), pair.slice(i + 1)];
      if (value === "" || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }
  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const absolute = (location: string) => new URL(location, BASE).href;

// From a start request to where the browser lands on this instance at the end (its Location), with every cookie set on the way.
export async function signIn(start: Request, jar = new Jar()): Promise<{ location: string; jar: Jar; responses: Response[] }> {
  const responses: Response[] = [];
  const step = (res: Response) => (responses.push(jar.take(res)), res);
  let res = step(await oidcStartRoute(start));
  for (let hops = 0; hops < 6; hops++) {
    const to = res.headers.get("location");
    if (!to || res.status < 300 || res.status >= 400) break;
    // The instance's own URLs, whatever PUBLIC_URL says, are answered by its routes here.
    const own = process.env.PUBLIC_URL;
    const url = own && absolute(to).startsWith(own) ? BASE + absolute(to).slice(own.replace(/\/$/, "").length) : absolute(to);
    const headers = { host: "localhost:3000", cookie: jar.header() };
    if (url.startsWith(`${BASE}/api/auth/`)) res = step(await authRoute(new Request(url, { headers })));
    else if (url.startsWith(`${BASE}/api/oidc/finish`)) res = step(await oidcFinishRoute(new Request(url, { headers })));
    else if (!url.startsWith(BASE) && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url)) res = step(await fetch(url, { redirect: "manual" })); // the mock provider
    else break;
  }
  return { location: res.headers.get("location") ?? "", jar, responses };
}
