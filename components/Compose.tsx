"use client";

import { Camera, Hash, Plus, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { bare, card, field, primary } from "@/components/styles";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { MarkdownInput } from "@/components/MarkdownInput";
import { usePendingImages } from "@/components/usePendingImages";
import { multipart, useApiForm } from "@/app/_lib/useApiForm";
import { errorMessage, PASSWORD_HINT, SENDER_NOTICE, TOO_MANY_PICTURES, withPictures } from "@/app/_lib/messages";
import { addPending, removeReference, type Pending } from "@/components/pendingFiles";
import { PASSWORD_PATTERN } from "@/shared/password";
import { TAGS_HINT, TAGS_PATTERN } from "@/shared/tags";

// The compose box posts through the API client generated from openapi.json (the session cookie rides along same-origin) and
// shows refusals inline: the text as a raw markdown post, or, with pictures dropped, pasted or picked (they wait in the box,
// usePendingImages), the text and the pictures in one multipart request, so nothing is half-posted.
// `isNew`: a feed that doesn't exist yet, so the box offers to protect it with a password. `licensing`: the instance sells licenses
// (ADR 0029), so a password needs one: the box takes the license key next to the password and the post creates the feed protected
// and licensed in one go (issue #193); a post refused for the lack of a license (402) gets a banner that says what to do, with the
// feed's settings (`settingsHref`, an existing feed) as the place to enter a key. `errorCode` is the code behind `error`.
// `images` false: the instance takes no pictures.
// `imageBase`: the feed's read link, for the preview's stored pictures. `initialTitle` and `initialText`: what was shared to
// notefeed from another app (app/share), so the box opens with it.
// Below lg: the phone layout of components/AppShell.tsx.
const NARROW = "(max-width: 63.98rem)";
const subscribeNarrow = (onChange: () => void) => {
  const q = window.matchMedia(NARROW);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
};

export function Compose({
  feed,
  action,
  error: initialError,
  errorCode,
  isNew,
  licensing,
  settingsHref,
  sender,
  images: imagesOn = true,
  imageBase,
  initialTitle = "",
  initialText = "",
}: {
  feed: string;
  action: string;
  error?: string;
  errorCode?: string;
  isNew?: boolean;
  licensing?: boolean;
  settingsHref?: string;
  sender?: boolean;
  images?: boolean;
  imageBase?: string;
  initialTitle?: string;
  initialText?: string;
}) {
  const images = usePendingImages();
  const { run, error, code, setError, pending, router } = useApiForm(action, initialError, withPictures(errorMessage, images.pending.length > 0), errorCode);
  const [text, setText] = useState(initialText);
  const [password, setPassword] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const licenseRefused = code === "license_required";
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState(initialTitle);

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const headers = {
    ...(title.trim() && { "X-Note-Title": encodeHeaderValue(title.trim()) }),
    ...(password && { "X-Feed-Password": password }),
    ...(password && licenseKey.trim() && { "X-License-Key": licenseKey.trim() }),
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

  // On a phone, once hydrated: a chat-style bar docked at the bottom (issue #185). Its field is the note's text (the same
  // state as the full box's), Send posts it, ＋ opens the full box as a sheet for the title, tags, pictures and the preview.
  // Like a messenger's (issue #203): while the bar is empty, a camera button stands where Send goes, so a photo is two taps
  // (the camera, then Send). The photo waits with the full box's pictures (shrunk on posting like them) and shows above the
  // field. On a computer `capture` is ignored and the button opens the file picker. The bar keeps clear of the screen's rounded
  // corners and the home indicator (issue #202).
  // Without JavaScript, and from lg, the box is a card at the top of the feed. The bar is only rendered on a narrow
  // screen, so the page never holds two note fields where both could show.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const [open, setOpen] = useState(!!initialError || !!initialText);
  const form = useRef<HTMLFormElement>(null);
  const quick = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const empty = !text.trim() && images.pending.length === 0;
  const addPhotos = (files: File[]) => {
    const { added, leftOut } = addPending(images.pending, files);
    if (leftOut) setError(TOO_MANY_PICTURES);
    if (!added.length) return;
    setText((t) => [t.trimEnd(), ...added.map((p) => `![](${p.token})`)].filter(Boolean).join("\n"));
    images.setPending([...images.pending, ...added]);
  };
  const removePhoto = (p: Pending) => {
    URL.revokeObjectURL(p.preview);
    setText((t) => removeReference(t, p.token));
    images.setPending(images.pending.filter((q) => q.key !== p.key));
  };
  // The bar's field grows with its text, up to about five lines.
  useLayoutEffect(() => {
    const q = quick.current;
    if (!q) return;
    q.style.height = "auto";
    q.style.height = `${Math.min(q.scrollHeight, 132)}px`;
  });
  // A refusal shows in the full box, so on a phone the box is open while there is one; closing it clears the refusal.
  const opened = open || (narrow && !!error);
  const close = () => {
    setOpen(false);
    setError(undefined);
  };
  const docked = hydrated && !opened;
  const sheet = hydrated && opened;
  const openSheet = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById("markdown")?.focus());
  };
  useEffect(() => {
    if (!opened) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setError(undefined);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [opened, setError]);

  return (
    <>
      {docked && narrow && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-2.5 lg:hidden">
          {images.pending.length > 0 && (
            <ul aria-label="Photos to send" className="mb-2 flex gap-2 overflow-x-auto pt-1.5 pr-1.5">
              {images.pending.map((p) => (
                <li key={p.key} className="relative shrink-0" title={p.token}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" className="h-14 w-14 rounded-xl border border-rule object-cover" />
                  <button type="button" onClick={() => removePhoto(p)} aria-label={`Remove ${p.token}`} className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-paper">
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {imagesOn && (
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label="Photo from the camera"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = ""; // the same photo can be taken again
                if (files.length) addPhotos(files);
              }}
            />
          )}
          <div className="flex items-end gap-1.5">
            <button type="button" onClick={openSheet} aria-label="Title, tags and pictures" title="Title, tags and pictures" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-carbon hover:bg-surface-2">
              <Plus aria-hidden className="h-[22px] w-[22px]" />
            </button>
            <textarea
              ref={quick}
              rows={1}
              aria-label="Quick note in markdown"
              placeholder="Write a note…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit();
              }}
              className="block max-h-[8.25rem] min-h-10 min-w-0 flex-1 resize-none rounded-[1.25rem] border border-rule bg-surface-2 px-4 py-2 text-[15px] leading-normal placeholder:text-muted focus:border-carbon/60 focus-visible:outline-none"
            />
            {imagesOn && empty ? (
              <button type="button" onClick={() => camera.current?.click()} aria-label="Take a photo" title="Take a photo" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-carbon hover:bg-surface-2">
                <Camera aria-hidden className="h-[22px] w-[22px]" />
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || empty}
                onClick={() => form.current?.requestSubmit()}
                aria-label="Send note"
                title="Send note"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon disabled:opacity-40"
              >
                <Send aria-hidden className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>
        </div>
      )}
      {sheet && <div aria-hidden className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={close} />}
      <form
        ref={form}
        onSubmit={submit}
        aria-label="New note"
        className={`${card} mb-6 px-4 pt-3 pb-2 focus-within:border-carbon/60 ${docked ? "max-lg:hidden" : ""} ${sheet ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:mb-0 max-lg:max-h-[90dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-sheet max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))]" : ""}`}
      >
        {sheet && (
          <div className="-mx-4 mb-2 flex items-center justify-between border-b border-rule px-2 pb-2 lg:hidden">
            <button type="button" onClick={close} aria-label="Close" title="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2">
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
            {licensing && (
              <>
                <label htmlFor="new-feed-license-key" className="mb-1 mt-3 block text-muted">
                  License key (needed with a password)
                </label>
                <input
                  id="new-feed-license-key"
                  name="license_key"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  aria-describedby="new-feed-license-key-hint"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  className={`${field} max-w-sm font-mono`}
                />
                <p id="new-feed-license-key-hint" className="mt-1 text-muted">
                  A feed password is for licensed feeds, and a feed can only get a password when it is created.{" "}
                  <Link href="/license" className="text-carbon underline">
                    Buy a license
                  </Link>{" "}
                  and enter its key here: the first note then creates the feed protected and licensed.
                </p>
              </>
            )}
          </div>
        )}
        {sender && <p className="mt-2 text-sm text-muted">{SENDER_NOTICE}</p>}
        {licenseRefused && <LicenseNeeded isNew={!!isNew} password={password !== ""} keyGiven={licenseKey.trim() !== ""} settingsHref={settingsHref} />}
        <p id="compose-error" role="alert" className="text-sm text-error empty:hidden">
          {licenseRefused ? "" : error}
        </p>
      </form>
    </>
  );
}

// The post was refused with 402 (`license_required`): a banner instead of the one red line, with what needs the license, what to
// do and where (issue #193). `password`: the box holds a password, so that is what was refused (else it was the pictures);
// `keyGiven`: a key was sent with it, so the key's license is not active.
function LicenseNeeded({ isNew, password, keyGiven, settingsHref }: { isNew: boolean; password: boolean; keyGiven: boolean; settingsHref?: string }) {
  const what = password ? "A feed password needs a license." : "Pictures need a license.";
  const next =
    isNew && password
      ? keyGiven
        ? "The license of the key you entered is not active any more: it has lapsed or was refunded. Buy a license and enter its key below the password."
        : "Buy a license and enter its key below the password: the first note then creates the feed protected and licensed. A feed can only get a password when it is created."
      : "This feed is on the free tier. Buy a license and enter its key under License in the feed's settings.";
  return (
    <section role="alert" aria-labelledby="license-needed" className="mt-3 rounded-xl border border-error/40 bg-error/5 p-4 text-sm">
      <p id="license-needed" className="font-bold text-ink">
        {what}
      </p>
      <p className="mt-1 text-muted">{next}</p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-bold">
        <Link href="/license" className="text-carbon underline">
          Buy a license
        </Link>
        {settingsHref && (
          <Link href={`${settingsHref}#license`} className="text-carbon underline">
            Feed settings
          </Link>
        )}
      </p>
    </section>
  );
}
