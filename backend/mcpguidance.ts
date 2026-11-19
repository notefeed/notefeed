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

// `yours`: the client is signed in as the feed's owner, who needs no password for it (ADR 0059).
export function afterFeed(f: { readUrl: string | null; protected: boolean; yours: boolean; freeTier?: { notes: number; cap: number } | null }): string[] {
  const parts = [f.readUrl ? `Readers follow the feed at ${f.readUrl}; ${SHARE}.` : "The feed has no read link yet: it comes with the first note."];
  if (f.protected && f.yours)
    parts.push("This client, signed in as its owner, needs no password for it; scripts and other clients use its feed passwords (list_feed_passwords).");
  else if (f.protected) parts.push("The feed has a password: every call for it needs it.");
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
  if (r.license === "on") parts.push("The feed is under the account's license now: it keeps all its notes, takes pictures and can have a feed password.");
  if (r.license === "off")
    parts.push("The feed is off the account's license and on the free tier again; the unit it used can cover another of the account's feeds (get_license).");
  if (!parts.length) parts.push("Saved.");
  return parts;
}

export const afterCreate = (f: Parameters<typeof afterFeed>[0]): string[] => ["The feed is created, with no notes.", ...afterFeed(f)];

export const afterRecover = (removed: boolean): string[] => [
  removed
    ? "The feed's password is removed: the feed is open to anyone who knows its name. Suggest a new password with update_feed's new_password."
    : "The feed has a new password: every later call needs it; tell the user to update scripts and integrations that post.",
];

// An upload made (#381): how the bytes get there, and what then takes the id.
export function afterCreateUpload(r: { url: string; id: string; expires: string; maxBytes: number }): string[] {
  return [
    `Send the file from a shell, raw bytes, not base64: curl -sS --fail-with-body -T <path to the file> "${r.url}"`,
    `If curl fails before notefeed answers (a proxy refuses the host, or the name doesn't resolve), the shell's network doesn't reach ${new URL(r.url).host}: in claude.ai's code execution, tell the user to allow that domain in the network access setting, then try again. A file the user attached in claude.ai is under /mnt/user-data/uploads/.`,
    `Then post it with upload_id "${r.id}" instead of data: post_file, an attachment of post_note, or set_feed_image. The type may be left out there.`,
    `The URL takes one file of at most ${r.maxBytes} bytes and works until ${r.expires}; the upload is gone once it is posted. Keep the URL to yourself: whoever has it can send the file.`,
  ];
}

export const afterSetImage = (): string[] => ['The title image shows in the feed\'s header and on its read link. update_feed with image "" removes it.'];

export const afterDeleteFeed = (): string[] => [
  "The feed is deleted with all its notes; its read link stays empty for good. Feed readers keep what they fetched. The name is free again: a post to it creates a new feed.",
];

export function afterLicenses(l: { buy_url: string }): string[] {
  return [
    `A license belongs to an account: buy_license gives the user a checkout link for the account this client signed in as, or send them to ${l.buy_url}.`,
    "Then put one of the account's feeds under it with update_feed's licensed true; get_license shows what it covers.",
  ];
}

// Accounts (#389, #390).
export const afterListFeeds = (n: number): string[] =>
  n
    ? ["These are the account's own feeds: it manages their passwords, renames and deletes them."]
    : ["The account owns no feed yet: create_feed or claim_feed makes one its own."];
export const afterClaim = (): string[] => [
  "The feed is the account's now. Its password keeps working as 'Feed password'; add_feed_password gives each person or script one of their own.",
];
export const afterListFeedPasswords = (n: number): string[] =>
  n
    ? ["revoke_feed_password stops one by its id; the others keep working."]
    : ["The feed has no password: it is open to anyone who knows its name. It stays the account's."];
export const afterAddSecret = (what: "feed password" | "account token"): string[] => [
  `This is the only time the ${what} is shown: hand it to the person to store in their password manager, and do not repeat it later.`,
  ...(what === "account token"
    ? ["It works on the REST API only, as Authorization: Bearer <token>, never on MCP."]
    : ["It is sent as X-Feed-Password, or entered on the feed's page."]),
];
export const afterRevoke = (what: "feed password" | "account token"): string[] => [`The ${what} stops working at once.`];
export const afterListTokens = (n: number): string[] =>
  n ? ["revoke_account_token stops one by its id."] : ["The account has no tokens: create_account_token makes one for a script."];

// The license on the account (#391).
export const afterLicense = (l: { units: number; covered: string[]; licensed: string[] }): string[] => {
  const parts = [`The license covers ${l.units} feed${l.units === 1 ? "" : "s"}; ${l.licensed.length} are under it now.`];
  const over = l.covered.filter((f) => !l.licensed.includes(f));
  if (over.length)
    parts.push(
      `More feeds are under it than it covers: ${over.join(", ")} are on the free tier until the units are raised (change_license_units) or another is taken off.`,
    );
  if (!l.units) parts.push("buy_license buys one for this account.");
  return parts;
};
export const afterCheckout = (): string[] => [
  "Give the person this URL to open and pay at; nothing is charged before they do. Once paid, the subscription is on the account (get_license shows it), and update_feed's licensed true puts a feed under it.",
];
export const afterUnits = (): string[] => ["Changed. get_license shows the license as it is now."];
