import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { CopyProvider } from "@/components/CopyProvider";
import { LANG_COOKIE, negotiate } from "@/shared/copy";
import NotFound from "./[lang]/not-found";
import { mono, sans } from "./fonts";
import "./globals.css";

// An address no route matches (#352: the root layout is in app/[lang], so there is none to compose this from). The same page as every
// notFound(), in its own document, in the language the proxy would have picked.
export const metadata: Metadata = { title: "notefeed" };

export default async function GlobalNotFound() {
  const lang = negotiate((await cookies()).get(LANG_COOKIE)?.value, (await headers()).get("accept-language"));
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">
        <CopyProvider lang={lang}>
          <NotFound />
        </CopyProvider>
      </body>
    </html>
  );
}
