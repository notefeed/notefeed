// What each MCP tool result tells Claude to say or do next (the MCP-first convention, #357), worked out from what the call did, as a
// list of short instructions:
// a draft, a scheduled note, a renamed feed and a new read link each need different words. Tool descriptions say what a tool
// does; this says what just happened, where a client that drops the descriptions or the server instructions still sees it.

type NoteState = { draft?: boolean; scheduled?: boolean; date?: string };

const SHARE = "share the read link, never the feed's name: the name is what posts to it";

// Whether readers see a note, and how that changes.
function visibility(n: NoteState): string {
  if (n.draft) return "It is a draft: readers don't see it until it is published with edit_note's draft false.";
  if (n.scheduled) return `It is scheduled: readers see it from ${n.date}, not before.`;
  return "Readers see it now.";
}

export function afterPost(r: NoteState & { url: string; readUrl: string | null; created: boolean; attachments: number }): string[] {
  const parts = [`The note is at ${r.url} (the owner's view).`, visibility(r)];
  if (r.attachments) parts.push(`${r.attachments} picture${r.attachments === 1 ? " was" : "s were"} posted with it, each a note of its own.`);
  if (r.created) parts.push(`This post created the feed. Readers follow it at ${r.readUrl}; ${SHARE}.`);
  else if (r.readUrl && !r.draft && !r.scheduled) parts.push(`Readers follow the feed at ${r.readUrl}.`);
  return parts;
}

export function afterPostFile(r: NoteState & { url: string }): string[] {
  if (r.draft || r.scheduled) return [visibility(r), `Its URL ${r.url} answers 404 until then; get_note with picture true shows it to the owner.`];
  return [visibility(r), `Its URL ${r.url} is public, like the feed's read link: anyone with it can open the file.`];
}

export function afterList(r: { next: string | null; drafts: number; scheduled: number; shown: number }): string[] {
  const parts = [r.next ? `There are more notes: call list_notes again with before: "${r.next}".` : "There are no more notes."];
  const hidden = [r.drafts && `${r.drafts} draft${r.drafts === 1 ? "" : "s"}`, r.scheduled && `${r.scheduled} scheduled`].filter(Boolean);
  if (hidden.length) parts.push(`Of the ${r.shown} listed, readers don't see ${hidden.join(" and ")}.`);
  return parts;
}

export const afterGetNote = (n: NoteState): string[] => [visibility(n)];

export const afterEdit = (n: NoteState & { url: string }): string[] => [`Saved; the note keeps its id and its link ${n.url}.`, visibility(n)];

export const afterDeleteNote = (): string[] => [
  "The note is deleted for good. Feed readers that fetched it already keep their copy; tell the user if it must not be seen.",
];

export function afterFeed(f: { readUrl: string | null; protected: boolean; freeTier?: { notes: number; cap: number } | null }): string[] {
  const parts = [f.readUrl ? `Readers follow the feed at ${f.readUrl}; ${SHARE}.` : "The feed has no read link yet: it comes with the first note."];
  if (f.protected) parts.push("The feed has a password: every call for it needs it.");
  if (f.freeTier && f.freeTier.notes >= f.freeTier.cap * 0.9)
    parts.push(
      `It is on the free tier with ${f.freeTier.notes} of ${f.freeTier.cap} notes: past the cap each new note drops the oldest. A license keeps them all.`,
    );
  return parts;
}

export function afterUpdate(
  r: { name?: string; readIdChanged: boolean; newPassword: boolean; license?: "on" | "off" } & Parameters<typeof afterFeed>[0],
): string[] {
  const parts: string[] = [];
  if (r.name)
    parts.push(
      `Renamed to ${r.name}: use it in every later call. Tell the user to change the name wherever it is configured (NOTEFEED_FEED, CI secrets, scripts, MCP configurations) before those run again: a post to the old name creates a new, empty feed.`,
    );
  if (r.readIdChanged)
    parts.push(`The old read link stops working: tell the user to give readers the new one, ${r.readUrl ?? "which comes with the first note"}.`);
  if (r.newPassword) parts.push("The feed has a new password: every later call needs it; tell the user to update scripts and integrations that post.");
  if (r.license === "on") parts.push("The license is on this feed now (and off the feed it was on).");
  if (r.license === "off") parts.push("The license is off this feed: its key can go on another feed.");
  if (!parts.length) parts.push("Saved.");
  return parts;
}

export const afterCreate = (f: Parameters<typeof afterFeed>[0]): string[] => ["The feed is created, with no notes.", ...afterFeed(f)];

export const afterRecover = (removed: boolean): string[] => [
  removed
    ? "The feed's password is removed: the feed is open to anyone who knows its name. Suggest a new password with update_feed's new_password."
    : "The feed has a new password: every later call needs it; tell the user to update scripts and integrations that post.",
];

export const afterSetImage = (): string[] => ['The title image shows in the feed\'s header and on its read link. update_feed with image "" removes it.'];

export const afterDeleteFeed = (): string[] => [
  "The feed is deleted with all its notes; its read link stays empty for good. Feed readers keep what they fetched. The name is free again: a post to it creates a new feed.",
];

export function afterLicenses(l: { buy_url: string }): string[] {
  return [
    `To buy, send the user to ${l.buy_url}; the key comes after paying.`,
    "Put it on a feed with update_feed's license_key, or with create_feed or post_note when the feed is created.",
  ];
}
