import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { LicenseNeeded } from "@/components/Compose";
import { FreeTierNotice } from "@/components/FreeTier";
import { LicenseSection } from "@/components/LicenseSection";
import { ProtectFeed } from "@/components/ProtectFeed";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

// The links and prompts to buy follow the license page (ADR 0035): without it they go, and what a key holder needs stays.
const usage = { notes: 10, cap: 10 };

test.each([true, false])("licensePage=%s: a link to /license exactly when the page exists", (licensePage) => {
  for (const el of [
    <FreeTierNotice key="1" usage={usage} licensePage={licensePage} />,
    <ProtectFeed feed="f" key="2" licensing licensePage={licensePage} />,
    <LicenseSection key="3" feed="f" freeTier={usage} licensePage={licensePage} />,
    <LicenseSection key="4" feed="f" freeTier={null} licensePage={licensePage} />,
    <LicenseNeeded key="5" isNew password keyGiven={false} licensePage={licensePage} />,
    <LicenseNeeded key="6" isNew password keyGiven licensePage={licensePage} />,
    <LicenseNeeded key="7" isNew={false} password={false} keyGiven={false} settingsHref="/f/settings" licensePage={licensePage} />,
  ])
    expect(renderToStaticMarkup(el).includes('href="/license"')).toBe(licensePage);
});

test("without the page, the key field, the count and the 402 banner stay, and nothing says to buy", () => {
  const section = renderToStaticMarkup(<LicenseSection feed="f" freeTier={usage} licensePage={false} />);
  expect(section).toContain('placeholder="License key"');
  expect(section).toContain("Free tier · 10 of 10 notes");
  expect(section).toContain("Enter a license key to lift these limits.");
  expect(renderToStaticMarkup(<ProtectFeed feed="f" licensing licensePage={false} />)).toContain('name="license_key"');
  const banner = renderToStaticMarkup(<LicenseNeeded isNew={false} password={false} keyGiven={false} settingsHref="/f/settings" licensePage={false} />);
  expect(banner).toContain("Pictures need a license.");
  expect(banner).toContain("This feed is on the free tier. Enter a license key under License in the feed&#x27;s settings.");
  expect(banner).toContain('href="/f/settings#license"');
  expect(renderToStaticMarkup(<FreeTierNotice usage={usage} licensePage={false} />)).toContain("This feed is at its 10 free notes: each new note drops the oldest one.");
  for (const html of [section, banner, renderToStaticMarkup(<FreeTierNotice usage={usage} licensePage={false} />), renderToStaticMarkup(<ProtectFeed feed="f" licensing licensePage={false} />)])
    expect(html).not.toMatch(/Buy a license|A license<\/a>/);
});

test("with the page, the texts are as before", () => {
  expect(renderToStaticMarkup(<LicenseNeeded isNew={false} password={false} keyGiven={false} licensePage />)).toContain("This feed is on the free tier. Buy a license and enter its key under License in the feed&#x27;s settings.");
  expect(renderToStaticMarkup(<FreeTierNotice usage={usage} licensePage />)).toContain("keeps them all.");
});
