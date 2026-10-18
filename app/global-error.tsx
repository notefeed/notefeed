"use client";
import "./globals.css";
import { ErrorPage } from "@/components/ErrorPage";
import { primary } from "@/components/styles";

// When the root layout itself fails: the same page as app/error.tsx, with its own document, since it replaces the layout.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="antialiased">
      <head>
        <title>Something went wrong</title>
      </head>
      <body className="font-sans text-base leading-relaxed">
        <ErrorPage
          title="Something went wrong"
          actions={
            <button type="button" onClick={() => retry()} className={primary}>
              Try again
            </button>
          }
        >
          <p>This page couldn&apos;t be loaded just now. Trying again often helps. If it keeps happening, let the operator of this site know.</p>
          {error.digest && <p className="text-sm">Reference for the operator: {error.digest}</p>}
        </ErrorPage>
      </body>
    </html>
  );
}
