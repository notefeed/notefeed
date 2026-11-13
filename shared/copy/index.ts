// The UI's words, one copy module per language (the language convention, #352): every user-facing string of app/ and components/
// comes from here, so a second language is a new module and no code change. English is the reference; copy.test.ts checks every
// other language against it. What people post is never translated. Server code takes copyFor(lang); client components useCopy().
import { en, type Copy } from "./en";

export type { Copy } from "./en";

// The languages the UI speaks, the first the default. A new one: its module, typed Copy, added here.
export const COPIES = { en } satisfies Record<string, Copy>;
export type Locale = keyof typeof COPIES;
export const LOCALES = Object.keys(COPIES) as Locale[];
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && Object.hasOwn(COPIES, v);
export const copyFor = (lang: string): Copy => COPIES[isLocale(lang) ? lang : DEFAULT_LOCALE];

// The cookie that keeps a language a person picked over what their browser asks for.
export const LANG_COOKIE = "nf_lang";
// The request header the proxy sets to the page's language, for server components (app/_lib/copy.ts). The proxy always sets it.
export const LANG_HEADER = "x-notefeed-lang";

// The language for a request: the picked one (the cookie) if the UI speaks it, else the best of Accept-Language
// (q-values honoured, "de-AT" matches "de"), else the default.
export function negotiate(picked: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(picked)) return picked;
  const asked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((a) => a.tag && a.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of asked) {
    if (isLocale(tag)) return tag;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
