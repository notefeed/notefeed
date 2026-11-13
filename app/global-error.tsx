"use client";
import "./globals.css";
import { FailedPage, failedTitle } from "@/components/ErrorPage";
import { DEFAULT_LOCALE, copyFor } from "@/shared/copy";

// When the root layout itself fails: the same page as app/[lang]/error.tsx, with its own document, since it replaces the layout. With
// no layout there is no page language to take: the default one.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = copyFor(DEFAULT_LOCALE);
  return (
    <html lang={DEFAULT_LOCALE} className="antialiased">
      <head>
        <title>{failedTitle(t, error)}</title>
      </head>
      <body className="font-sans text-base leading-relaxed">
        <FailedPage t={t} error={error} retry={retry} />
      </body>
    </html>
  );
}
