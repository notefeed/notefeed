"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackIcon } from "@/components/icons";
import { deleteNote } from "@/app/_lib/api";
import { messagesFor } from "@/app/_lib/messages";
import { useCopy } from "@/components/CopyProvider";
import { card, danger } from "@/components/styles";

// A damaged note's own page (encryption at rest, issue #212): what happened, the way back, and for its owner (`feed`) the one thing
// that still works on it, deleting it. Through the API client like NoteActions; on success, back to the feed like a delete there.
export function DamagedNote({ feed, id, back }: { feed?: string; id: string; back: string }) {
  const router = useRouter();
  const t = useCopy();
  const { errorMessage, UNREADABLE } = messagesFor(t);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    setPending(true);
    const { response, error: refusal } = await deleteNote({ baseUrl: window.location.origin, path: { feed: feed!, id } });
    if (response?.ok || response?.status === 404) return router.replace(`${back}?deleted=${id}`); // already gone: the goal is met
    setPending(false);
    setError(errorMessage((refusal as { code?: string } | undefined)?.code) ?? t.damaged.deleteFailed);
  }
  return (
    <article className={`${card} p-4`}>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-carbon">
        <BackIcon aria-hidden size={16} /> {t.damaged.back}
      </Link>
      <p role="status">{UNREADABLE}</p>
      <p className="mt-1 text-sm text-muted">{t.damaged.lost}</p>
      {feed && (
        <div className="mt-4">
          <button type="button" onClick={remove} disabled={pending} className={danger}>
            {t.damaged.delete}
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
