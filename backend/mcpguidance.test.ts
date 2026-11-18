// The guidance texts about licenses (#391, ADR 0061): a license is the account's, a feed is put under it or taken off; no keys.
import { expect, test } from "vitest";
import { afterLicenses, afterUpdate } from "./mcpguidance";

const feed = { readUrl: "https://n.example/r/x/feed.xml", protected: true, freeTier: null };
const update = (license: "on" | "off") => afterUpdate({ ...feed, readIdChanged: false, newPassword: false, license });

test("putting a feed under the license, or taking it off, says what changes for that feed, and nothing about another feed or a key", () => {
  expect(update("on")).toEqual([expect.stringMatching(/under the account's license/)]);
  expect(update("off")).toEqual([expect.stringMatching(/free tier/)]);
  for (const text of [...update("on"), ...update("off")]) expect(text).not.toMatch(/key|feed it was on/);
});

test("get_licenses points to buy_license and update_feed's licensed, not to keys", () => {
  const text = afterLicenses({ buy_url: "https://n.example/license" }).join(" ");
  expect(text).toMatch(/buy_license/);
  expect(text).toMatch(/licensed/);
  expect(text).not.toMatch(/key/);
});
