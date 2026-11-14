import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { LicenseNeeded } from "@/components/Compose";
import { FreeTierNotice } from "@/components/FreeTier";
import { en } from "@/shared/copy/en";
import { LicenseSection } from "@/components/LicenseSection";
import { ProtectFeed } from "@/components/ProtectFeed";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

// The links and prompts to buy follow the license page (ADR 0035): without it they go, and what a key holder needs stays.
const usage = { notes: 10, cap: 10 };

test.each([true, false])("licensePage=%s: a link to /license exactly when the page exists", (licensePage) => {
  for (const el of [
    <FreeTierNotice t={en} key="1" usage={usage} licensePage={licensePage} />,
    <ProtectFeed t={en} feed="f" key="2" licensing licensePage={licensePage} />,
    <LicenseSection key="3" feed="f" freeTier={usage} licensePage={licensePage} yours />,
    <LicenseNeeded key="5" isNew password licensePage={licensePage} />,
    <LicenseNeeded key="7" isNew={false} password={false} settingsHref="/f/settings" licensePage={licensePage} />,
  ])
    expect(renderToStaticMarkup(el).includes('href="/license"')).toBe(licensePage);
});

test("without the page, the count, the owner's button and the 402 banner stay, and nothing says to buy", () => {
  const section = renderToStaticMarkup(<LicenseSection feed="f" freeTier={usage} licensePage={false} yours />);
  expect(section).toContain("Free tier · 10 of 10 notes");
  expect(section).toContain("Put it under your license");
  expect(renderToStaticMarkup(<LicenseSection feed="f" freeTier={usage} licensePage={false} yours={false} />)).not.toContain("Put it under your license");
  expect(renderToStaticMarkup(<ProtectFeed t={en} feed="f" licensing licensePage={false} />)).not.toContain('name="license_key"');
  const banner = renderToStaticMarkup(<LicenseNeeded isNew={false} password={false} settingsHref="/f/settings" licensePage={false} />);
  expect(banner).toContain("Pictures need a license.");
  expect(banner).toContain("This feed is on the free tier. Its owner puts it under their account&#x27;s license in the feed&#x27;s settings.");
  expect(banner).toContain('href="/f/settings#license"');
  for (const html of [section, banner, renderToStaticMarkup(<FreeTierNotice t={en} usage={usage} licensePage={false} />)])
    expect(html).not.toMatch(/Buy a license|A license<\/a>/);
});

test("with the page, the free tier's notice points to it", () => {
  expect(renderToStaticMarkup(<FreeTierNotice t={en} usage={usage} licensePage />)).toContain("keeps them all.");
});
