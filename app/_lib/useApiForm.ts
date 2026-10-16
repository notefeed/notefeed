"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { postNote } from "@/app/_lib/api";
import { encodeHeaderValue } from "@/shared/headers";
import { contentTypeOf, sniffImage } from "@/shared/images";
import { errorMessage, imageErrorMessage } from "@/app/_lib/messages";
import { shrinkImage } from "@/app/_lib/shrinkImage";

type Result = { data?: unknown; error?: { code?: string; error?: string }; response?: Response };

// The enhanced-form logic shared by the compose box and the edit and delete forms: `run` submits through a
// generated client call, `done` runs on success (or on status `doneOn`); a 401 goes to the feed page, which shows
// its unlock form (or proxy.ts sends a missing instance login on to /login); other refusals become `error`,
// worded by `message` (given the code, the Retry-After and the server's own message), with the server's `code` next to
// it for a form that shows some refusals differently (the compose box's license banner). `initialCode` is the code
// behind `initialError`, when the page knows it. `setError` is a message of the form's own (or an update of the one
// shown, as a state setter takes), with no code.
export function useApiForm(page: string, initialError?: string, message: (code: unknown, retry?: unknown, detail?: string) => string | undefined = errorMessage, initialCode?: string) {
  const router = useRouter();
  const [refusal, setRefusal] = useState<{ error?: string; code?: string }>({ error: initialError, code: initialError ? initialCode : undefined });
  const setError = useCallback((next?: string | ((shown: string | undefined) => string | undefined)) => setRefusal((r) => ({ error: typeof next === "function" ? next(r.error) : next })), []);
  const [pending, setPending] = useState(false);

  async function run<T extends Result>(e: FormEvent | undefined, call: () => Promise<T>, done: (result: T) => void, doneOn?: number) {
    e?.preventDefault();
    setPending(true);
    try {
      const result = await call();
      const { error, response } = result;
      if (!response) throw new Error("no response"); // the client returns a network failure instead of throwing it
      if (response.ok || response.status === doneOn) return done(result);
      if (response.status === 401) return router.push(page);
      const code = error?.code ?? "unknown";
      setRefusal({ error: message(code, response.headers.get("retry-after"), error?.error), code });
    } catch {
      setError("Could not reach notefeed. Check your connection and try again.");
    }
    setPending(false);
  }

  return { run, error: refusal.error, code: refusal.code, setError, pending, setPending, router };
}

// The type the bytes say, not the one the browser guessed from the name: a PNG named .jpg is a PNG. Anything unknown keeps the browser's type, and the server refuses it.
const typeOfBytes = async (file: File) => {
  const ext = sniffImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  return ext ? contentTypeOf(ext) : file.type;
};

/**
 * The multipart body of a note with its pictures (POST or PUT): the text as a `text/markdown` file part (a field's line breaks
 * would be sent as CRLF), none when `text` is undefined; one `file` part per picture, named by its token (the name the text refers
 * to it by), shrunk to NOTEFEED_SHRINK_IMAGE_BYTES (shrinkImage), of the type its bytes say; an `alt.<token>` field for each alt text given.
 */
export async function multipartBody(text: string | undefined, pictures: { token: string; file: File }[], alts: Record<string, string> = {}): Promise<FormData> {
  const form = new FormData();
  if (text !== undefined) form.append("text", new Blob([text], { type: "text/markdown" }), "text.md");
  for (const { token, file } of pictures) {
    const sent = await shrinkImage(file);
    form.append("file", new File([sent], token, { type: await typeOfBytes(sent) }));
  }
  for (const [token, alt] of Object.entries(alts)) form.append(`alt.${token}`, alt);
  return form;
}

// The generated client's options for a multipart body: postNote and editNote send their body as is (`bodySerializer: null` in
// sdk.gen.ts); the caller sends no Content-Type, so fetch writes the boundary.
export const multipart = (form: FormData) => ({ body: form as never });

// Posts one image, shrunk to NOTEFEED_SHRINK_IMAGE_BYTES (shrinkImage), to the feed as a note of its own (the generated client; the server checks the bytes against the declared type) and returns the
// note's id and file name, or the refusal's message. `password` is only for the post that creates a protected feed; `meta` is a title and tags to put on the picture. Shared by the
// title image.
export async function postFile(feed: string, file: File, password?: string, meta: { title?: string; tags?: string[] } = {}): Promise<{ id: string; file: string; url: string } | { error: string }> {
  try {
    const sent = await shrinkImage(file);
    const { data, error, response } = await postNote({
      baseUrl: window.location.origin,
      path: { feed },
      body: sent,
      headers: {
        "Content-Type": await typeOfBytes(sent), // the server accepts only the types it lists, and checks the bytes against it
        ...(password && { "X-Feed-Password": password }),
        ...(meta.title && { "X-Note-Title": encodeHeaderValue(meta.title) }),
        ...(meta.tags?.length && { "X-Note-Tags": meta.tags.join(",") }),
      },
    });
    if (!response) throw new Error("no response");
    if (response.ok && data?.file) return { id: data.id, file: data.file, url: data.file_url ?? "" };
    return { error: imageErrorMessage((error as { code?: string } | undefined)?.code ?? "unknown", response.headers.get("retry-after")) ?? "Something went wrong." };
  } catch {
    return { error: "Could not reach notefeed. Check your connection and try again." };
  }
}
