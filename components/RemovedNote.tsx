"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackIcon } from "@/components/icons";
import { deleteNote } from "@/app/_lib/api";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";
import { card, danger } from "@/components/styles";

// The operator's mark (#159, ADR 0052) as a list shows it: what happened, and the instance's terms when it has some.
export function RemovedMark({ terms }: { terms?: boolean }) {
  const t = useCopy();
  return (
    <p role="status" className="text-muted">
      {t.removed.mark}
      {terms && (
        <>
          {" "}
          <Link href="/terms" className="underline hover:text-carbon">
            {t.removed.terms}
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
  const t = useCopy();
  const { errorMessage } = messagesFor(t);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    setPending(true);
    const { response, error: refusal } = await deleteNote({ baseUrl: window.location.origin, path: { feed: feed!, id } });
    if (response?.ok || response?.status === 404) return router.replace(`${back}?deleted=${id}`); // already gone: the goal is met
    setPending(false);
    setError(errorMessage((refusal as { code?: string } | undefined)?.code) ?? t.removed.deleteFailed);
  }
  return (
    <article className={`${card} p-4`}>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-carbon">
        <BackIcon aria-hidden size={16} /> {t.damaged.back}
      </Link>
      <RemovedMark terms={terms} />
      {feed && mark && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted">{t.removed.deleteHint}</p>
          <button type="button" onClick={remove} disabled={pending} className={danger}>
            {t.removed.delete}
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
