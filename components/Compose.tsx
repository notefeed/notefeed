"use client";

import { Hash, PenSquare, Send, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { bare, card, field, primary } from "@/components/styles";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, useApiForm } from "@/app/_lib/useApiForm";
import { errorMessage, PASSWORD_HINT, SENDER_NOTICE, withPictures } from "@/app/_lib/messages";
import { PASSWORD_PATTERN } from "@/shared/password";
import { TAGS_HINT, TAGS_PATTERN } from "@/shared/tags";

// The compose box posts through the API client generated from openapi.json (the session cookie rides along same-origin) and
// shows refusals inline: the text as a raw markdown post, or, with pictures dropped, pasted or picked (they wait in the box,
// usePendingImages), the text and the pictures in one multipart request, so nothing is half-posted.
// `isNew`: a feed that doesn't exist yet, so the box offers to protect it with a password. `images` false: the instance takes no pictures.
// `imageBase`: the feed's read link, for the preview's stored pictures. `initialTitle` and `initialText`: what was shared to
// notefeed from another app (app/share), so the box opens with it.
export function Compose({ feed, action, error: initialError, isNew, sender, images: imagesOn = true, imageBase, initialTitle = "", initialText = "" }: { feed: string; action: string; error?: string; isNew?: boolean; sender?: boolean; images?: boolean; imageBase?: string; initialTitle?: string; initialText?: string }) {
  const images = usePendingImages();
  const { run, error, setError, pending, router } = useApiForm(action, initialError, withPictures(errorMessage, images.pending.length > 0));
  const [text, setText] = useState(initialText);
  const [password, setPassword] = useState("");
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState(initialTitle);

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const headers = {
    ...(title.trim() && { "X-Note-Title": encodeHeaderValue(title.trim()) }),
    ...(password && { "X-Feed-Password": password }),
    ...(tagList.length && { "X-Note-Tags": tagList.join(",") }),
  };
  // The page remounts this box empty. With pictures only, the answer is the first picture's.
  const submit = (e: FormEvent) =>
    run(
      e,
      async () => {
        const form = await images.body(text); // undefined: no pictures, a raw markdown post
        return postNote({
          baseUrl: window.location.origin,
          path: { feed },
          ...(form
            ? { ...multipart(form), headers: { ...headers, "Content-Type": null } }
            : { body: new Blob([text], { type: "text/markdown" }), headers: { ...headers, "Content-Type": "text/markdown" } }),
        });
      },
      ({ data }) => router.push(`${action}?posted=${data?.id}`),
    );

  // On a phone, once hydrated: the box waits as a bar docked at the bottom and opens as a sheet (issue #185). Without
  // JavaScript, and from lg, it is a card at the top of the feed.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [open, setOpen] = useState(!!initialError || !!initialText);
  const docked = hydrated && !open;
  const sheet = hydrated && open;
  const openSheet = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById("markdown")?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  return (
    <>
      {docked && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 lg:hidden">
          <div className="flex items-center gap-2">
            <button type="button" onClick={openSheet} className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-rule bg-surface-2 px-4 text-left text-[15px] text-muted">
              Write a note…
            </button>
            <button type="button" onClick={openSheet} aria-label="New note" title="New note" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon">
              <PenSquare aria-hidden className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      )}
      {sheet && <div aria-hidden className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}
      <form
        onSubmit={submit}
        aria-label="New note"
        className={`${card} mb-6 px-4 pt-3 pb-2 focus-within:border-carbon/60 ${docked ? "max-lg:hidden" : ""} ${sheet ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:mb-0 max-lg:max-h-[90dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-sheet max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]" : ""}`}
      >
        {sheet && (
          <div className="-mx-4 mb-2 flex items-center justify-between border-b border-rule px-2 pb-2 lg:hidden">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" title="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2">
              <X aria-hidden className="h-5 w-5" />
            </button>
            <span className="truncate rounded-full border border-rule bg-surface-2 px-3 py-1 text-[13px] font-bold text-carbon">{feed}</span>
            <span className="w-9" />
          </div>
        )}
        <MarkdownInput
          id="markdown"
          name="markdown"
          label="Note in markdown"
          value={text}
          onChange={setText}
          rows={sheet ? 6 : 3}
          placeholder="Write a note in markdown…"
          describedBy="compose-hint compose-error"
          pending={images.pending}
          onPendingChange={images.setPending}
          onMessage={setError}
          images={imagesOn}
          imageBase={imageBase}
          bare
          above={
            <>
              <label htmlFor="note-title" className="sr-only">
                Title (optional, otherwise taken from the text)
              </label>
              <input id="note-title" name="title" type="text" autoComplete="off" maxLength={100} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className={`${bare} text-[17px] font-bold tracking-tight placeholder:font-normal`} />
            </>
          }
          below={
            <div className="mt-2 flex items-center gap-1.5 rounded-full bg-surface-2/70 px-3 py-1 sm:max-w-sm">
              <Hash aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
              <label htmlFor="note-tags" className="sr-only">
                Tags (optional, separated by commas)
              </label>
              <input id="note-tags" name="tags" type="text" autoComplete="off" placeholder="Tags, e.g. ci, deploy" pattern={TAGS_PATTERN} title={TAGS_HINT} value={tags} onChange={(e) => setTags(e.target.value)} className={`${bare} text-[13px]`} />
            </div>
          }
        >
          <span id="compose-hint" className="ml-auto mr-2 hidden min-w-0 break-all text-[12px] text-muted sm:inline">
            Markdown · Ctrl+Enter to post
          </span>
          <button type="submit" disabled={pending} aria-label="Post note" className={`${primary} max-sm:ml-auto`}>
            <Send aria-hidden className="h-4 w-4" />
            {pending ? "Posting…" : "Post"}
          </button>
        </MarkdownInput>
        {isNew && (
          <div className="mt-3 border-t border-rule pt-3 text-sm">
            <label htmlFor="new-feed-password" className="mb-1 block text-muted">
              Password (optional, protects this feed)
            </label>
            <input
              id="new-feed-password"
              name="password"
              type="password"
              autoComplete="new-password"
              maxLength={256}
              pattern={PASSWORD_PATTERN}
              title={PASSWORD_HINT}
              aria-describedby="new-feed-password-hint"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${field} max-w-sm`}
            />
            <p id="new-feed-password-hint" className="mt-1 text-muted">
              {PASSWORD_HINT}
            </p>
          </div>
        )}
        {sender && <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>}
        <p id="compose-error" role="alert" className="text-sm text-error empty:hidden">
          {error}
        </p>
      </form>
    </>
  );
}
