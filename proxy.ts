import { NextResponse, type NextRequest } from "next/server";
import { locked, noteOutcome, publicUrl, sessionOk } from "@/backend";
import { LANG_COOKIE, LANG_HEADER, negotiate } from "@/shared/copy";

// Exactly one segment, after stripping one trailing slash. Kept percent-encoded: the route's
// [feed] param is decoded by Next and the handler rejects anything outside FEED_RE ("a%2Fb" → "a/b" → 400).
const ONE_SEGMENT = /^\/([^/]+)\/?$/;

// Pages are GET-only; every POST is a backend route handler. /<feed> and /login are also pages, and
// Next can't put a route handler next to a page, so their POSTs are rewritten. Method and path decide,
// never headers: the same rule a reverse proxy would apply if the backend moved out.
function postTarget(pathname: string): string | null {
  const seg = ONE_SEGMENT.exec(pathname)?.[1];
  if (seg === undefined || seg === "logout" || seg === "mcp" || seg === "metrics" || seg === "health") return null; // /logout, /mcp, /metrics and /health are route handlers themselves
  return seg === "login" ? "/api/login" : `/api/v1/feeds/${seg}/notes`; // reserved names get the handler's 400
}

// The UI's language (Next's internationalization guide, #352): every page lives under app/[lang], and the proxy rewrites a page's
// path to /<lang>/<path>, so no URL carries the language and every link, read link and bookmark stays as it was. The language is
// the one picked (the nf_lang cookie), else the browser's Accept-Language, else English. Route handlers outside app/[lang] are
// left alone: the API, MCP, metrics, health, logout, OAuth's endpoints, a read link's RSS, Atom and files, and the static files.
// /<feed>'s own POST handlers (access, delete, details, license, files) live under app/[lang]/[feed], so they are rewritten too.
const NOT_A_PAGE =
  /^\/(?:api\/|_next\/|\.well-known\/|shortcuts\/|oauth\/(?:register|token)$|(?:mcp|metrics|health|logout)$|r\/[^/]+\/(?:[^/]*\.[^/]*|files\/.*)$|(?:icon\.svg|icon-[\w-]+\.png|apple-icon\.png|opengraph-image\.png|manifest\.webmanifest|sw\.js|favicon\.ico)$)/;

function localized(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (NOT_A_PAGE.test(pathname)) return NextResponse.next();
  const lang = negotiate(req.cookies.get(LANG_COOKIE)?.value, req.headers.get("accept-language"));
  // Also as a request header, for server components below a page that have no params of their own (app/_lib/copy.ts).
  const headers = new Headers(req.headers);
  headers.set(LANG_HEADER, lang);
  return NextResponse.rewrite(new URL(`/${lang}${pathname === "/" ? "" : pathname}${search}`, req.url), { request: { headers } });
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (req.method === "POST") {
    if (pathname === "/") return Response.json({ error: "no feed in URL" }, { status: 404 });
    const target = postTarget(pathname);
    if (target) return NextResponse.rewrite(new URL(target, req.url));
  }

  // next.config.ts sets skipTrailingSlashRedirect so POST /<feed>/ reaches the rewrite above;
  // everything else keeps Next's usual 308 to the path without the slash.
  if (pathname !== "/" && pathname.endsWith("/")) {
    return NextResponse.redirect(new URL(pathname.slice(0, -1) + search, publicUrl(req.headers)), 308);
  }

  // /login, /mcp, OAuth, and well-known paths are exempt from the lock because each checks credentials itself
  // (/health has none to check: a probe carries no session, and it says only whether the instance answers);
  // redirecting them to /login would turn a script's 401 into a success-looking 307.
  // Icons, the manifest and the share image are public too, so the login page and link previews have them; so is the service
  // worker (public/sw.js), the same file for everyone, so a browser whose sign-in ran out can still update it.
  // /privacy and /imprint are public so the footer links work before signing in (the imprint must be easy to reach,
  // and the privacy page says what signing in stores). /report is reached from the read-only views, which are public.
  const exempt =
    pathname === "/login" ||
    pathname === "/report" ||
    pathname === "/mcp" ||
    pathname === "/metrics" ||
    pathname === "/health" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/license" ||
    pathname === "/imprint" ||
    /^\/(r|_next|api|oauth|\.well-known)\//.test(pathname) ||
    /^\/(icon\.svg|icon-[\w-]+\.png|apple-icon\.png|opengraph-image\.png|manifest\.webmanifest|sw\.js)$/.test(pathname);
  if (!locked() || exempt) return localized(req);
  if (await sessionOk(req.headers)) return localized(req);
  // Must be absolute (Next rejects a relative Location here); built from the public base,
  // not req.url, so it is right behind a reverse proxy.
  noteOutcome("auth");
  const login = new URL("/login", publicUrl(req.headers));
  // checked by safeNext after login; / needs none, unless it carries what was shared to notefeed (the share target)
  if (pathname !== "/" || search) login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Next's assets never pass through. /r/** (read-only feeds) does, for its pages' language; it is exempt from the lock above.
export const config = {
  matcher: "/((?!_next/|favicon\\.ico).*)",
};
