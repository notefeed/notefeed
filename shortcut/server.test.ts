// The Shortcut against the server (#334): its actions, played by a small stand-in for Shortcuts, post to the real API handler.
// Shortcuts itself can't run here; what it does with each action is what source.ts assumes (as cherri lists the actions). The
// interpreter covers only the actions the Shortcut uses.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { resetFeedsForTests } from "../backend/feeds";
import { API_PREFIX, dispatch } from "../backend/http/api";
import { resetRateLimitsForTests } from "../backend/limits";
import { JPG } from "../backend/testimages";
import { shortcutPlist } from "./source";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-shortcut-"));
  process.env.NOTEFEED_SECRET = "s".repeat(32);
  for (const k of ["NOTEFEED_PASSWORD", "NOTEFEED_RATE_LIMIT", "PUBLIC_URL"]) delete process.env[k];
  resetFeedsForTests();
  resetRateLimitsForTests();
});

type Picture = { picture: Uint8Array; name: string };
/** A page shared from Safari: its text is the whole page, its URL the address. */
type Page = { page: string; url: string };
type Item = string | Picture | Page;
type Value = undefined | string | Picture | Item[] | Record<string, unknown>;
type Action = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Record<string, unknown> };
type Ref = { Type: string; OutputUUID?: string; VariableName?: string };

const isPicture = (v: unknown): v is Picture => typeof v === "object" && v !== null && "picture" in v;
const isPage = (v: unknown): v is Page => typeof v === "object" && v !== null && "page" in v;
const hasValue = (v: Value) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
const asText = (v: Value): string =>
  Array.isArray(v) ? v.map((i) => asText(i)).join("\n") : isPicture(v) ? v.name : isPage(v) ? v.page : typeof v === "string" ? v : "";

const host = "http://localhost:3000";
/** Share `items` with the imported Shortcut (`answers` to its four questions); what it opened and showed. */
async function share(items: Item[], answers = [host, "phone", "", ""]) {
  const actions = (shortcutPlist() as { WFWorkflowActions: Action[] }).WFWorkflowActions;
  const out: Record<string, Value> = {};
  const vars: Record<string, Value> = {};
  const opened: string[] = [];
  const shown: string[] = [];
  let repeatItem: Value;

  const resolve = (r: Ref): Value =>
    r.Type === "ExtensionInput" ? items : r.Type === "ActionOutput" ? out[r.OutputUUID!] : r.VariableName === "Repeat Item" ? repeatItem : vars[r.VariableName!];
  const arg = (p: unknown): Value => {
    const v = p as { Value: unknown; WFSerializationType: string } | undefined;
    if (v === undefined) return undefined;
    if (typeof v === "string") return v;
    if (v.WFSerializationType === "WFTextTokenAttachment") return resolve(v.Value as Ref);
    const { string, attachmentsByRange } = v.Value as { string: string; attachmentsByRange: Record<string, Ref> };
    const parts = Object.entries(attachmentsByRange).sort(([a], [b]) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
    let i = 0;
    return string.replace(/￼/g, () => asText(resolve(parts[i++][1])));
  };
  const headersOf = (p: unknown) =>
    Object.fromEntries(
      (p as { Value: { WFDictionaryFieldValueItems: Array<{ WFKey: unknown; WFValue: unknown }> } }).Value.WFDictionaryFieldValueItems.map((h) => [
        asText(arg(h.WFKey)),
        asText(arg(h.WFValue)),
      ]),
    );

  // Where each block's Otherwise and End are, by grouping identifier.
  const marks: Record<string, Record<number, number>> = {};
  actions.forEach((a, i) => {
    const g = a.WFWorkflowActionParameters.GroupingIdentifier as string | undefined;
    if (g) (marks[g] ??= {})[a.WFWorkflowActionParameters.WFControlFlowMode as number] = i;
  });

  const run = async (from: number, to: number): Promise<"exit" | void> => {
    for (let i = from; i < to; i++) {
      const id = actions[i].WFWorkflowActionIdentifier.replace("is.workflow.actions.", "");
      const p = actions[i].WFWorkflowActionParameters;
      const uuid = p.UUID as string;
      const g = p.GroupingIdentifier as string;
      if (id === "conditional") {
        const { 1: otherwise, 2: end } = marks[g];
        const subject = arg((p.WFInput as { Variable: unknown }).Variable);
        const yes =
          p.WFCondition === 100 ? hasValue(subject) : p.WFCondition === 99 ? asText(subject).includes(asText(arg(p.WFConditionalActionString))) : fail(p.WFCondition);
        const result = yes ? await run(i + 1, otherwise ?? end) : otherwise !== undefined ? await run(otherwise + 1, end) : undefined;
        if (result === "exit") return "exit";
        i = end;
      } else if (id === "repeat.each") {
        const end = marks[g][2];
        const list = arg(p.WFInput);
        for (const item of Array.isArray(list) ? list : hasValue(list) ? [list as Item] : []) {
          repeatItem = item;
          if ((await run(i + 1, end)) === "exit") return "exit";
        }
        i = end;
      } else if (id === "gettext") out[uuid] = i < answers.length ? answers[i] : asText(arg(p.WFTextActionText)); // the first four: the answers
      else if (id === "text.trimwhitespace") out[uuid] = asText(arg(p.WFInput)).trim();
      else if (id === "text.changecase") out[uuid] = asText(arg(p.text)).toLowerCase();
      else if (id === "text.replace") {
        const flags = p.WFReplaceTextCaseSensitive === false ? "gi" : "g";
        out[uuid] = asText(arg(p.WFInput)).replace(new RegExp(p.WFReplaceTextFind as string, flags), p.WFReplaceTextReplace as string);
      } else if (id === "text.combine") out[uuid] = asText(arg(p.text));
      else if (id === "setvariable") vars[p.WFVariableName as string] = arg(p.WFInput);
      else if (id === "appendvariable") vars[p.WFVariableName as string] = [...((vars[p.WFVariableName as string] as Item[]) ?? []), arg(p.WFInput) as Item];
      else if (id === "detect.images") {
        const v = arg(p.WFInput);
        const list: unknown[] = Array.isArray(v) ? v : [v];
        out[uuid] = list.filter(isPicture);
      } else if (id === "detect.text") out[uuid] = asText(arg(p.WFInput));
      else if (id === "detect.link") {
        const v = arg(p.WFInput);
        out[uuid] = isPage(v) ? [v.url] : (asText(v).match(/https?:\/\/\S+/g) ?? []);
      } else if (id === "getitemtype") {
        const v = arg(p.WFInput);
        out[uuid] = isPicture(v) ? "Image" : isPage(v) ? "Safari web page" : "Text";
      } else if (id === "properties.files") out[uuid] = isPicture(arg(p.WFFolder)) ? "jpeg" : "";
      else if (id === "getitemfromlist") out[uuid] = (arg(p.WFInput) as Item[])[0];
      else if (id === "image.convert") {
        const v = arg(p.WFInput);
        out[uuid] = Array.isArray(v) ? v[0] : v;
      } else if (id === "downloadurl") {
        const url = new URL(asText(arg(p.WFURL)));
        if (p.WFHTTPBodyType !== "File") throw new Error(`the stand-in sends only raw bodies, not ${String(p.WFHTTPBodyType)}`);
        const v = arg(p.WFRequestVariable);
        const body: BodyInit = isPicture(v) ? (v.picture as BodyInit) : asText(v);
        const req = new Request(url, { method: p.WFHTTPMethod as string, headers: { host: url.host, ...headersOf(p.WFHTTPHeaders) }, body });
        const res = await dispatch(req, url.pathname.slice(API_PREFIX.length + 1).split("/"));
        out[uuid] = (await res.json()) as Record<string, unknown>;
      } else if (id === "getvalueforkey") out[uuid] = (arg(p.WFInput) as Record<string, unknown>)[p.WFDictionaryKey as string] as Value;
      else if (id === "openurl") opened.push(asText(arg(p.WFInput)));
      else if (id === "showresult") shown.push(asText(arg(p.Text)));
      else if (id === "exit") return "exit";
      else throw new Error(`the stand-in doesn't know ${id}`);
    }
  };
  await run(0, actions.length);
  // The temporary debug alerts (#334) are no answer.
  return { opened, shown: shown.filter((m) => !m.startsWith("Debug, ")), debug: shown.filter((m) => m.startsWith("Debug, ")) };
}

function fail(condition: unknown): never {
  throw new Error(`the stand-in doesn't know condition ${String(condition)}`);
}

async function notes(feed = "phone", password = "") {
  const url = new URL(`${API_PREFIX}/feeds/${feed}/notes`, host);
  const res = await dispatch(new Request(url, { headers: { host: url.host, "x-feed-password": password } }), ["feeds", feed, "notes"]);
  return ((await res.json()) as { notes: Array<{ type: string; content?: string; url: string }> }).notes;
}

const photo = (name: string): Picture => ({ picture: JPG, name });
const broken = (name: string): Picture => ({ picture: new TextEncoder().encode("not a picture"), name });

test("two photos and a text become one note with both pictures, which opens", async () => {
  const { opened, shown } = await share([photo("IMG_0001"), photo("IMG_0002"), "From the phone"]);
  const all = await notes();
  const note = all.find((n) => n.type === "text/markdown")!;
  expect(all.filter((n) => n.type === "image/jpeg")).toHaveLength(2);
  expect(note.content).toMatch(/^From the phone\n\n!\[\]\([\w-]+\.jpg\)\n!\[\]\([\w-]+\.jpg\)$/);
  expect(opened).toEqual([note.url]);
  expect(shown).toEqual([]);
});

test("photos alone: the note is the pictures, without their file names as text", async () => {
  await share([photo("IMG_0001"), photo("IMG_0002")]);
  const note = (await notes()).find((n) => n.type === "text/markdown")!;
  expect(note.content).toMatch(/^!\[\]\([\w-]+\.jpg\)\n!\[\]\([\w-]+\.jpg\)$/);
});

test("a picture refused doesn't stop the others: the note is posted with them, and a hint says what failed", async () => {
  const { opened, shown } = await share([photo("IMG_0001"), broken("IMG_0002"), "Look"]);
  const note = (await notes()).find((n) => n.type === "text/markdown")!;
  expect(note.content).toMatch(/^Look\n\n!\[\]\([\w-]+\.jpg\)$/);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatch(/^Posted, but not everything:\nA picture was not posted: \S/);
  expect(opened).toEqual([note.url]);
});

test("only refused pictures and no text: nothing is posted, and it says why", async () => {
  const { opened, shown } = await share([broken("IMG_0001")]);
  expect(await notes()).toEqual([]);
  expect(opened).toEqual([]);
  expect(shown[0]).toMatch(/^Not posted:\nA picture was not posted: \S/);
});

test("a page shared from Safari is its address, not the page's text; a text with a link stays as written", async () => {
  await share([{ page: "debug\n\nYour feeds\nRemembered on this device.", url: "https://notefeed.me/debug" }]);
  expect((await notes())[0].content).toBe("https://notefeed.me/debug");
  await share(["Read this: https://example.com/a and https://example.com/b"]);
  expect((await notes())[0].content).toBe("Read this: https://example.com/a and https://example.com/b");
});

test("the temporary debug alert names each item's type, extension and text", async () => {
  const { debug } = await share([photo("IMG_0001"), "Hi"]);
  expect(debug).toEqual(["Debug, item: type [Image] extension [jpeg] text [IMG_0001]", "Debug, item: type [Text] extension [] text [Hi]"]);
});

test("a link alone is a note of its own; nothing shared says so", async () => {
  await share(["https://example.com/article"]);
  expect((await notes())[0].content).toBe("https://example.com/article");
  expect((await share([])).shown).toEqual(["Nothing to post: share pictures, text or a link."]);
});

test("a wrong feed password: nothing is posted, and the server's reason is shown", async () => {
  await share(["first"], [host, "locked", "", ""]);
  const url = new URL(`${API_PREFIX}/feeds/locked/password`, host);
  // Protect the feed, then share with the wrong password.
  const set = await dispatch(new Request(url, { method: "PUT", headers: { host: url.host, "content-type": "application/json" }, body: JSON.stringify({ password: "right-password" }) }), ["feeds", "locked", "password"]);
  expect(set.status).toBeLessThan(300);
  const { opened, shown } = await share([photo("IMG_0001"), "Hello"], [host, "locked", "wrong", ""]);
  expect(opened).toEqual([]);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatch(/^Not posted: \S/);
  expect(await notes("locked", "right-password")).toHaveLength(1);
});

test("the server password: empty posts where the server has none; where it has one, it is checked", async () => {
  expect((await share(["open"])).opened).toHaveLength(1);
  process.env.NOTEFEED_PASSWORD = "server-pw";
  expect((await share(["no"], [host, "phone", "", ""])).opened).toEqual([]);
  expect((await share(["yes"], [host, "phone", "", "server-pw"])).opened).toHaveLength(1);
});
