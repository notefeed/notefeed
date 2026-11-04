"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { deleteNote } from "@/app/_lib/api";
import { errorMessage } from "@/app/_lib/messages";
import { card, danger } from "@/components/styles";
import { REMOVED_NOTE } from "@/shared/notekinds";

// The operator's mark (#159, ADR 0052) as a list shows it: what happened, and the instance's terms when it has some.
export function RemovedMark({ terms }: { terms?: boolean }) {
  return (
    <p role="status" className="text-muted">
      {REMOVED_NOTE}
      {terms && (
        <>
          {" "}
          <Link href="/terms" className="underline hover:text-carbon">
            Terms
          </Link>
        </>
      )}
    </p>
  );
}

// A removed note's own page: the mark, the way back, and for its owner (`feed`) while the mark is there (`mark`) the one thing that
// works on it, deleting it (V9). The note itself does not come back; its page says so after the mark is gone too. Through the API
// client like DamagedNote; on success, back to the feed like a delete there.
export function RemovedNote({ feed, id, back, mark, terms }: { feed?: string; id: string; back: string; mark?: boolean; terms?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    setPending(true);
    const { response, error: refusal } = await deleteNote({ baseUrl: window.location.origin, path: { feed: feed!, id } });
    if (response?.ok || response?.status === 404) return router.replace(`${back}?deleted=${id}`); // already gone: the goal is met
    setPending(false);
    setError(errorMessage((refusal as { code?: string } | undefined)?.code) ?? "The mark could not be deleted. Try again.");
  }
  return (
    <article className={`${card} p-4`}>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-carbon">
        <ChevronLeft aria-hidden size={16} /> Back to the feed
      </Link>
      <RemovedMark terms={terms} />
      {feed && mark && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted">Deleting this mark takes it off the feed. The note does not come back.</p>
          <button type="button" onClick={remove} disabled={pending} className={danger}>
            Delete this mark
          </button>
          {error && (
            <p role="alert" className="mt-2 text-sm text-error">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
