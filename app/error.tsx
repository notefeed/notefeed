"use client";
import { FailedPage } from "@/components/ErrorPage";

// What a page that failed shows instead of Next's plain error (error.js, inside the root layout). Never the error's message: on the
// server it is hidden anyway, and it could name a host or a feed. The digest is the reference the operator finds in the log; the
// key service's own digest is the maintenance page.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <FailedPage error={error} retry={retry} />;
}
