"use client";
import { ErrorPage } from "@/components/ErrorPage";
import { primary } from "@/components/styles";

// What a page that failed shows instead of Next's plain error (error.js, inside the root layout). Never the error's message: on the
// server it is hidden anyway, and it could name a host or a feed. The digest is the reference the operator finds in the log.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
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
  );
}
