// The iPhone Shortcut "notefeed" (#334), as source. iOS doesn't put web apps in the share sheet (#148); this Shortcut is there instead.
// Importing it asks four things: the instance's address, the feed's name, its password (empty for an open feed) and the instance's
// password (empty unless the server has one, NOTEFEED_PASSWORD: an instance without one ignores the header). Everything shared
// in one go becomes one note (ADR 0021): each picture is posted on its own to POST /api/v1/feeds/<feed>/notes, then one markdown note
// with the text, if any, and a ![](file) for each picture that arrived, so the feed shows the pictures inside that note only. Not one
// multipart request: a form's file field sends only the first item of a list (2 photos in Pictures, 1 stored, on iOS 26). A picture
// refused doesn't stop the rest: the note is posted with the others and a hint names what failed. Photos are converted to JPEG on the
// phone, since notefeed does not take HEIC. A note that arrived opens in the browser; a refused one shows the server's `error`.
// iOS imports only signed Shortcuts: `npm run shortcut:sign` on a Mac signs this into public/shortcuts/notefeed.shortcut and records
// the source's hash next to it (checked by source.test.ts). Apple doesn't document the format; the keys below are the ones Shortcuts
// itself writes (the identifiers and glyphs as listed by cherri, https://github.com/electrikmilk/cherri).
import { createHash } from "node:crypto";
import { build, type PlistValue } from "plist";

const ADDRESS = "6E0F3A1C-2B4D-4C5E-8F60-71829304A501";
const FEED = "6E0F3A1C-2B4D-4C5E-8F60-71829304A502";
const PASSWORD = "6E0F3A1C-2B4D-4C5E-8F60-71829304A503";
const INSTANCE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50E";
const IMAGES = "6E0F3A1C-2B4D-4C5E-8F60-71829304A504";
const EACH = "6E0F3A1C-2B4D-4C5E-8F60-71829304A505";
const JPEG = "6E0F3A1C-2B4D-4C5E-8F60-71829304A506";
const TEXT = "6E0F3A1C-2B4D-4C5E-8F60-71829304A507";
const IS_PICTURE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A508";
const POST_PICTURE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A509";
const POST_NOTE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50A";
const URL_OF = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50B";
const ARRIVED = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50C";
const ERROR_OF = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50D";
const FILE_OF = "6E0F3A1C-2B4D-4C5E-8F60-71829304A50F";
const STORED = "6E0F3A1C-2B4D-4C5E-8F60-71829304A510";
const PICTURE_ERROR = "6E0F3A1C-2B4D-4C5E-8F60-71829304A511";
const JOINED_TEXTS = "6E0F3A1C-2B4D-4C5E-8F60-71829304A512";
const JOINED_PICTURES = "6E0F3A1C-2B4D-4C5E-8F60-71829304A513";
const BODY = "6E0F3A1C-2B4D-4C5E-8F60-71829304A514";
const NOTE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A515";
const ANYTHING = "6E0F3A1C-2B4D-4C5E-8F60-71829304A516";
const JOINED_PROBLEMS = "6E0F3A1C-2B4D-4C5E-8F60-71829304A517";
const HAD_PROBLEMS = "6E0F3A1C-2B4D-4C5E-8F60-71829304A518";
const NOTHING_PROBLEMS = "6E0F3A1C-2B4D-4C5E-8F60-71829304A519";
const PICTURE_LINE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A51A";
const PROBLEM_LINE = "6E0F3A1C-2B4D-4C5E-8F60-71829304A51B";
// Pictures holds ![](file) for each picture stored, Texts the text items, Problems a line for each picture refused.
const PICTURES = "Pictures";
const TEXTS = "Texts";
const PROBLEMS = "Problems";
// The answers to the import questions, cleaned up, under names the editor shows.
const ADDRESS_VAR = "Address";
const FEED_VAR = "Feed";
const PASSWORD_VAR = "Feed password";
const INSTANCE_VAR = "Server password";

type Attachment = Record<string, unknown>;
const output = (uuid: string, name: string): Attachment => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });
const variable = (name: string): Attachment => ({ Type: "Variable", VariableName: name });
/** One variable as a parameter. */
const value = (a: Attachment) => ({ Value: a, WFSerializationType: "WFTextTokenAttachment" });
/** Text with variables in it: each "￼" in `template` is the next of `parts`. */
function text(template: string, ...parts: Attachment[]) {
  const attachmentsByRange: Record<string, Attachment> = {};
  let at = 0;
  for (const part of parts) {
    at = template.indexOf("￼", at);
    attachmentsByRange[`{${at}, 1}`] = part;
    at++;
  }
  return { Value: { string: template, attachmentsByRange }, WFSerializationType: "WFTextTokenString" };
}
const action = (id: string, params: Record<string, unknown>) => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: params });
/** "If `a` has any value" (mode 0), "Otherwise" (1) and "End If" (2) of one block. */
const ifHasValue = (group: string, a: Attachment) =>
  action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: 100, WFInput: { Type: "Variable", Variable: value(a) } });
const otherwise = (group: string) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 });
const endIf = (group: string) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 2 });

// A header, as Shortcuts writes the items of WFHTTPHeaders.
const header = (key: string, v: ReturnType<typeof text>) => ({ WFItemType: 0, WFKey: text(key), WFValue: v });
const headers = (...items: ReturnType<typeof header>[]) => ({ Value: { WFDictionaryFieldValueItems: items }, WFSerializationType: "WFDictionaryFieldValue" });

// POST /api/v1/feeds/<feed>/notes, with the feed's password (an empty header is no password, so an open feed needs nothing) and the
// instance's (checked only where the instance has one; elsewhere ignored). Each is the body itself: a picture as image/jpeg, the note
// as text/markdown. Not a form: one with only text fields goes as application/x-www-form-urlencoded, which notefeed refuses.
const passwords = [header("X-Feed-Password", text("￼", variable(PASSWORD_VAR))), header("Authorization", text("Bearer ￼", variable(INSTANCE_VAR)))];
const notesUrl = () => text("￼/api/v1/feeds/￼/notes", variable(ADDRESS_VAR), variable(FEED_VAR));
const postPicture = (uuid: string, picture: Attachment) =>
  action("downloadurl", {
    UUID: uuid,
    WFURL: notesUrl(),
    WFHTTPMethod: "POST",
    WFHTTPBodyType: "File",
    WFRequestVariable: value(picture),
    ShowHeaders: true,
    WFHTTPHeaders: headers(header("Content-Type", text("image/jpeg")), ...passwords),
  });
const postNote = (uuid: string, note: Attachment) =>
  action("downloadurl", {
    UUID: uuid,
    WFURL: notesUrl(),
    WFHTTPMethod: "POST",
    WFHTTPBodyType: "File",
    WFRequestVariable: value(note),
    ShowHeaders: true,
    WFHTTPHeaders: headers(header("Content-Type", text("text/markdown")), ...passwords),
  });
const valueFor = (uuid: string, of: Attachment, key: string) => action("getvalueforkey", { UUID: uuid, WFInput: value(of), WFDictionaryKey: key });
/** Combine Text, one item per line: its input is `text`, not WFInput (as cherri lists it). */
const join = (uuid: string, name: string) => action("text.combine", { UUID: uuid, text: value(variable(name)), WFTextSeparator: "New Lines" });

// An answer as typed on a phone: the keyboard adds a space after a suggestion and capitalises the first letter, and an address may
// come without https:// or with a trailing slash. Any of these made "Get contents of URL" fail ("no conversion from rich text to
// URL") or post to another feed's name, so each answer is cleaned up before it is used. Keeping the address question's default
// leaves the answer empty on iOS 26, so an empty address is notefeed.me. `steps` run in order on the previous output. "Change case"
// takes its input as `text`, not `WFInput` (cherri lists it so): with WFInput its output was empty.
type Step = ["trim"] | ["lowercase"] | ["replace", string, string];
let cleanups = 0;
function cleaned(from: string, name: string, ...steps: Step[]) {
  const actions: ReturnType<typeof action>[] = [];
  let last: Attachment = output(from, "Text");
  for (const step of steps) {
    const uuid = `6E0F3A1C-2B4D-4C5E-8F60-71829304B${String(++cleanups).padStart(3, "0")}`;
    const input = text("￼", last);
    if (step[0] === "trim") actions.push(action("text.trimwhitespace", { UUID: uuid, WFInput: input }));
    else if (step[0] === "lowercase") actions.push(action("text.changecase", { UUID: uuid, text: input, WFCaseType: "lowercase" }));
    else actions.push(action("text.replace", { UUID: uuid, WFInput: input, WFReplaceTextFind: step[1], WFReplaceTextReplace: step[2], WFReplaceTextRegularExpression: true, WFReplaceTextCaseSensitive: false }));
    last = output(uuid, "Updated Text");
  }
  actions.push(action("setvariable", { WFVariableName: name, WFInput: value(last) }));
  return actions;
}

/** The Shortcut as the dictionary its file holds. */
export function shortcutPlist(): Record<string, unknown> {
  cleanups = 0;
  return {
    // Shortcuts on iOS 26.
    WFWorkflowClientVersion: "4033.0.4.3",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    // A note with text on taupe, the Shortcuts colour nearest notefeed's carbon (glyph and colour numbers as cherri lists them).
    WFWorkflowIcon: { WFWorkflowIconStartColor: 2846468607, WFWorkflowIconGlyphNumber: 61465 },
    WFWorkflowTypes: ["ActionExtension"],
    WFWorkflowHasShortcutInputVariables: true,
    // notefeed takes markdown and pictures: images, text and links, nothing else.
    WFWorkflowInputContentItemClasses: ["WFImageContentItem", "WFStringContentItem", "WFRichTextContentItem", "WFURLContentItem"],
    // What the settings page shows: the address, the feed's name, its password and whether the instance has one.
    WFWorkflowImportQuestions: [
      { ActionIndex: 0, Category: "Parameter", DefaultValue: "https://notefeed.me", ParameterKey: "WFTextActionText", Text: "notefeed address (e.g. https://notefeed.me)" },
      { ActionIndex: 1, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Feed name" },
      { ActionIndex: 2, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Feed password (empty for an open feed)" },
      { ActionIndex: 3, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Server password: optional, leave empty unless your own server asks for one at sign-in (never on notefeed.me)" },
    ],
    WFWorkflowActions: [
      action("gettext", { UUID: ADDRESS, WFTextActionText: "" }),
      action("gettext", { UUID: FEED, WFTextActionText: "" }),
      action("gettext", { UUID: PASSWORD, WFTextActionText: "" }),
      action("gettext", { UUID: INSTANCE, WFTextActionText: "" }),
      ...cleaned(ADDRESS, ADDRESS_VAR, ["trim"], ["replace", "^$", "https://notefeed.me"], ["replace", "/+$", ""], ["replace", "^(?!https?://)", "https://"]),
      ...cleaned(FEED, FEED_VAR, ["trim"], ["lowercase"]),
      ...cleaned(PASSWORD, PASSWORD_VAR, ["trim"]),
      ...cleaned(INSTANCE, INSTANCE_VAR, ["trim"]),
      // Each item shared: a picture is posted on its own, as JPEG without its metadata (the server strips and shrinks it again anyway);
      // stored, it goes into Pictures as ![](file), refused, into Problems with the server's reason. Anything else is text (a link
      // becomes its address; a picture's text would be its file name, so pictures give none).
      action("repeat.each", { UUID: EACH, GroupingIdentifier: EACH, WFControlFlowMode: 0, WFInput: value({ Type: "ExtensionInput" }) }),
      action("detect.images", { UUID: IMAGES, WFInput: value(variable("Repeat Item")) }),
      ifHasValue(IS_PICTURE, output(IMAGES, "Images")),
      action("image.convert", { UUID: JPEG, WFInput: value(output(IMAGES, "Images")), WFImageFormat: "JPEG", WFImagePreserveMetadata: false }),
      postPicture(POST_PICTURE, output(JPEG, "Converted Image")),
      valueFor(FILE_OF, output(POST_PICTURE, "Contents of URL"), "file"),
      ifHasValue(STORED, output(FILE_OF, "Dictionary Value")),
      // "Add to Variable" takes a variable, not a text with one in it (given one, it added nothing): the line is a Text action first.
      action("gettext", { UUID: PICTURE_LINE, WFTextActionText: text("![](￼)", output(FILE_OF, "Dictionary Value")) }),
      action("appendvariable", { WFVariableName: PICTURES, WFInput: value(output(PICTURE_LINE, "Text")) }),
      otherwise(STORED),
      valueFor(PICTURE_ERROR, output(POST_PICTURE, "Contents of URL"), "error"),
      action("gettext", { UUID: PROBLEM_LINE, WFTextActionText: text("A picture was not posted: ￼", output(PICTURE_ERROR, "Dictionary Value")) }),
      action("appendvariable", { WFVariableName: PROBLEMS, WFInput: value(output(PROBLEM_LINE, "Text")) }),
      endIf(STORED),
      otherwise(IS_PICTURE),
      action("detect.text", { UUID: TEXT, WFInput: value(variable("Repeat Item")) }),
      action("appendvariable", { WFVariableName: TEXTS, WFInput: value(output(TEXT, "Text")) }),
      endIf(IS_PICTURE),
      action("repeat.each", { GroupingIdentifier: EACH, WFControlFlowMode: 2 }),
      // The note: the text, then the pictures that arrived, without the blank lines an empty part leaves.
      join(JOINED_TEXTS, TEXTS),
      join(JOINED_PICTURES, PICTURES),
      join(JOINED_PROBLEMS, PROBLEMS),
      action("gettext", { UUID: BODY, WFTextActionText: text("￼\n\n￼", output(JOINED_TEXTS, "Combined Text"), output(JOINED_PICTURES, "Combined Text")) }),
      action("text.replace", { UUID: NOTE, WFInput: text("￼", output(BODY, "Text")), WFReplaceTextFind: "^\\s+|\\s+$", WFReplaceTextReplace: "", WFReplaceTextRegularExpression: true }),
      ifHasValue(ANYTHING, output(NOTE, "Updated Text")),
      // TEMPORARY (#334): the note's parts and its text just before it is sent, to see where a part goes missing.
      action("showresult", {
        Text: text(
          "Debug, pictures: [￼] texts: [￼] note: [￼]",
          output(JOINED_PICTURES, "Combined Text"),
          output(JOINED_TEXTS, "Combined Text"),
          output(NOTE, "Updated Text"),
        ),
      }),
      postNote(POST_NOTE, output(NOTE, "Updated Text")),
      // The answer: the note's `url` to open (after a hint naming the pictures that didn't make it), or the server's `error` to show.
      valueFor(URL_OF, output(POST_NOTE, "Contents of URL"), "url"),
      ifHasValue(ARRIVED, output(URL_OF, "Dictionary Value")),
      ifHasValue(HAD_PROBLEMS, output(JOINED_PROBLEMS, "Combined Text")),
      action("showresult", { Text: text("Posted, but not everything:\n￼", output(JOINED_PROBLEMS, "Combined Text")) }),
      endIf(HAD_PROBLEMS),
      action("openurl", { WFInput: value(output(URL_OF, "Dictionary Value")) }),
      otherwise(ARRIVED),
      valueFor(ERROR_OF, output(POST_NOTE, "Contents of URL"), "error"),
      action("showresult", { Text: text("Not posted: ￼\n￼", output(ERROR_OF, "Dictionary Value"), output(JOINED_PROBLEMS, "Combined Text")) }),
      endIf(ARRIVED),
      otherwise(ANYTHING),
      ifHasValue(NOTHING_PROBLEMS, output(JOINED_PROBLEMS, "Combined Text")),
      action("showresult", { Text: text("Not posted:\n￼", output(JOINED_PROBLEMS, "Combined Text")) }),
      otherwise(NOTHING_PROBLEMS),
      action("showresult", { Text: text("Nothing to post: share pictures, text or a link.") }),
      endIf(NOTHING_PROBLEMS),
      endIf(ANYTHING),
    ],
  };
}

/** The Shortcut as an XML property list (unsigned; `plutil -convert binary1` and `shortcuts sign` make the file iOS imports). */
export const shortcutXml = (): string => build(shortcutPlist() as PlistValue);

/** The source's fingerprint, recorded next to the signed file when it is signed. */
export const shortcutSourceHash = (): string => createHash("sha256").update(shortcutXml()).digest("hex");
