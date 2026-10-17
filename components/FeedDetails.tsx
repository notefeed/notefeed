"use client";

import { AlignLeft, Fingerprint, ImagePlus, RefreshCw, Trash2, Type, UserRound, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { deleteFeed, updateFeed } from "@/app/_lib/api";
import { danger, field, primary, secondary } from "@/components/styles";
import { DisclosureRow, FieldRow, Group } from "@/components/SettingsRows";
import { feedDetailsErrorMessage } from "@/app/_lib/messages";
import { postFile, useApiForm } from "@/app/_lib/useApiForm";

// A feed's title image, title and description, and deleting it: plain forms to POST /<feed>/details and /delete.
// After the profile, the Sharing group: the read id first, then `sharing` (the read link rows). `children` (the license and
// access groups) sit between it and deleting, so deleting stays last. With
// JavaScript they go through the generated API client and show refusals inline; without, the browser follows
// the 303 (the feed page says "Saved." or shows the refusal as `error`, or the home page says "Feed deleted.").
export function FeedDetails({ feed, title: savedTitle, description: savedDescription, image, imageUrl, images, showSender: savedShowSender, readId, readIdChoice, identity, error: initialError, sharing, children }: { sharing?: ReactNode; children?: ReactNode; feed: string; title: string; description: string; image: string; imageUrl: string | null; images: { file: string; url: string; title: string }[]; showSender: boolean; readId: string | null; readIdChoice: "custom" | "random" | "fixed"; identity: boolean; error?: string }) {
  const page = `/${feed}/settings`;
  const { run, error, setError, pending, setPending, router } = useApiForm(page, initialError, feedDetailsErrorMessage);
  const [title, setTitle] = useState(savedTitle);
  const [description, setDescription] = useState(savedDescription);
  const [showSender, setShowSender] = useState(savedShowSender);
  const [readIdValue, setReadIdValue] = useState(readId ?? "");
  const [confirm, setConfirm] = useState("");
  // False while rendering on the server, true once hydrated: without JavaScript the delete button stays enabled
  // and the server checks the name.
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const opts = () => ({ baseUrl: window.location.origin, path: { feed } }); // in handlers only: no window while rendering on the server

  const picker = useRef<HTMLInputElement>(null);
  // The read id goes along with every save while it can be chosen; an unchanged one is no change to the server.
  const save = (e: FormEvent | undefined, body: { title: string; description: string; image?: string; show_sender?: boolean; read_id?: string } = { title, description, ...(identity && { show_sender: showSender }), ...(readIdChoice === "custom" && readId && { read_id: readIdValue }) }) =>
    run(e, () => updateFeed({ ...opts(), body }), () => {
      setError(undefined);
      setPending(false);
      router.replace(`${page}?saved=1`);
      router.refresh();
    });
  // The title image saves on its own, with the title and description as they stand in the form. A refusal shows in the row, not
  // at the foot of the page, where a phone's screen doesn't reach.
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string>();
  async function choose(file: File) {
    setError(undefined);
    setImageError(undefined);
    setPending(true);
    setUploading(true);
    const up = await postFile(feed, file);
    setUploading(false);
    if ("error" in up) {
      setImageError(up.error);
      setPending(false);
    } else save(undefined, { title, description, image: up.file, ...(identity ? { show_sender: showSender } : {}) });
  }
  const remove = (e: FormEvent) => run(e, () => deleteFeed(opts()), () => router.replace("/?deleted=" + feed), 404); // already gone: the goal is met

  const withSender = identity ? { show_sender: showSender } : {};

  return (
    <div className="space-y-6 text-sm">
      <Group id="profile" label="Profile">
        {hydrated && (
          <DisclosureRow
            icon={<ImagePlus />}
            label="Title image"
            value={
              imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Current title image" loading="lazy" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                "None"
              )
            }
          >
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              aria-label="Image for the feed header"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) choose(file);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => picker.current?.click()} className={secondary}>
                <ImagePlus aria-hidden className="h-4 w-4" />
                {uploading ? "Uploading…" : "Choose image"}
              </button>
              {image && (
                <button type="button" disabled={pending} onClick={() => save(undefined, { title, description, image: "", ...withSender })} className={`${secondary} bg-transparent font-normal text-muted`}>
                  <X aria-hidden className="h-4 w-4" />
                  Remove image
                </button>
              )}
            </div>
            <p role="alert" className="mt-2 text-error empty:hidden">
              {imageError}
            </p>
            {images.length === 0 && <p className="mt-2 text-muted">Pictures posted to this feed can be picked here too.</p>}
            {images.length > 0 && (
              <>
                <p className="mb-2 mt-4 text-muted">Or use one of this feed&apos;s images</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {images.map((i) => (
                    <button
                      key={i.file}
                      type="button"
                      disabled={pending}
                      aria-pressed={image === i.file}
                      aria-label={`Use ${i.title || i.file} as the title image`}
                      onClick={() => save(undefined, { title, description, image: i.file, ...withSender })}
                      className={`overflow-hidden rounded-xl border-2 disabled:opacity-60 ${image === i.file ? "border-carbon" : "border-transparent hover:border-rule"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={i.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </DisclosureRow>
        )}
        <form id="feed-details-form" method="post" action={`/${feed}/details`} onSubmit={(e) => save(e)} className="divide-y divide-rule">
          <FieldRow icon={<Type />} label="Title" htmlFor="feed-title">
            <input id="feed-title" name="title" maxLength={100} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
          </FieldRow>
          <FieldRow icon={<AlignLeft />} label="Description" htmlFor="feed-description">
            <input id="feed-description" name="description" maxLength={500} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
          </FieldRow>
          {identity && (
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input type="hidden" name="show_sender_present" value="1" />
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-carbon-soft text-carbon">
                <UserRound aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1 text-[15px]">Show who posted</span>
              <input type="checkbox" name="show_sender" checked={showSender} onChange={(e) => setShowSender(e.target.checked)} className="peer sr-only" />
              <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full bg-rule transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-surface after:shadow-card after:transition-transform peer-checked:bg-carbon peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-carbon" />
            </label>
          )}
          <div className="flex justify-end px-4 py-3">
            <button type="submit" disabled={pending} className={primary}>
              Save changes
            </button>
          </div>
        </form>
      </Group>

      <Group id="sharing" label="Sharing">
        {readIdChoice !== "fixed" && readId && (
          <DisclosureRow icon={<Fingerprint />} label="Read id" value={<code className="font-mono">{readId}</code>} open={!!initialError}>
            {readIdChoice === "custom" && (
              <>
                <label htmlFor="feed-read-id" className="mb-1 block text-muted">
                  Read id
                </label>
                <input id="feed-read-id" name="read_id" form="feed-details-form" minLength={3} maxLength={64} spellCheck={false} autoComplete="off" value={readIdValue} onChange={(e) => setReadIdValue(e.target.value)} className={`${field} mb-2 font-mono`} />
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {readIdChoice === "custom" && (
                <button type="submit" form="feed-details-form" disabled={pending} className={primary}>
                  Use this read id
                </button>
              )}
              <button type="submit" form="feed-details-form" name="generate_read_id" value="1" formNoValidate disabled={pending} onClick={(e) => { if (hydrated) { e.preventDefault(); save(undefined, { title, description, ...withSender, read_id: "" }); } }} className={secondary}>
                <RefreshCw aria-hidden className="h-4 w-4" />
                Generate a random one
              </button>
            </div>
            <p className="mt-2 text-muted">
              The read id is in the read link and the RSS link. {readIdChoice === "custom" && "3 to 64 characters: a–z, 0–9, - and _. "}A short, readable one can be guessed: protect the feed with a password if that matters. The old link stops showing this feed and may later show another one. Image links in your notes that are relative follow the new id; full URLs don&apos;t, and you change those yourself.
            </p>
          </DisclosureRow>
        )}
        {sharing}
      </Group>

      {children}

      <Group id="danger" label="Danger zone">
        <DisclosureRow icon={<Trash2 />} label="Delete this feed" danger>
          <form method="post" action={`/${feed}/delete`} onSubmit={remove}>
            <p className="text-muted">This deletes the feed and all its notes. It can&apos;t be undone. Type the feed&apos;s name to confirm.</p>
            <label htmlFor="feed-confirm" className="mb-1 mt-3 block text-muted">
              Feed name
            </label>
            <input id="feed-confirm" name="confirm" autoComplete="off" required pattern={feed} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${field} mb-3 font-mono`} />
            <button type="submit" disabled={pending || (hydrated && confirm !== feed)} className={danger}>
              <Trash2 aria-hidden className="h-4 w-4" />
              Delete feed
            </button>
          </form>
        </DisclosureRow>
      </Group>
      <p role="alert" className="text-error empty:hidden">
        {error}
      </p>
    </div>
  );
}
