"use client";
import "./globals.css";
import { FailedPage, failedTitle } from "@/components/ErrorPage";

// When the root layout itself fails: the same page as app/error.tsx, with its own document, since it replaces the layout.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="antialiased">
      <head>
        <title>{failedTitle(error)}</title>
      </head>
      <body className="font-sans text-base leading-relaxed">
        <FailedPage error={error} retry={retry} />
      </body>
    </html>
  );
}
