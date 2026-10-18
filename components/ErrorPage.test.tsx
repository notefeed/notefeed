// The pages a visitor sees when something is missing or broken: never Next's plain ones, never an error's own message.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import GlobalError from "@/app/global-error";
import ErrorBoundary from "@/app/error";
import NotFound from "@/app/not-found";
import { MAINTENANCE } from "@/app/_lib/messages";
import { UNAVAILABLE_DIGEST } from "@/shared/errors";
import { DamagedNote } from "./DamagedNote";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const failure = Object.assign(new Error("ECONNREFUSED 10.0.0.5:5432 secret-feed"), { digest: "abc123" });

test("the not-found page says so in words and leads back to the start page", () => {
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toContain("<h1");
  expect(html).toContain("Nothing here");
  expect(html).toContain('href="/"');
});

test("the error page offers to try again and a reference, never the error's message", () => {
  const html = renderToStaticMarkup(<ErrorBoundary error={failure} retry={() => {}} />);
  expect(html).toContain("Something went wrong");
  expect(html).toContain("Try again");
  expect(html).toContain("abc123");
  expect(html).not.toContain("ECONNREFUSED");
  expect(html).not.toContain("secret-feed");
  expect(html).toContain('href="/"');
});

test("the error page of the whole app brings its own document", () => {
  const html = renderToStaticMarkup(<GlobalError error={failure} retry={() => {}} />);
  expect(html).toMatch(/^<html[^>]*><head>.*<title>Something went wrong<\/title>/);
  expect(html).toContain("Try again");
  expect(html).not.toContain("ECONNREFUSED");
});

test("a damaged note's page says what happened; its owner can delete it, a reader can't", () => {
  const owner = renderToStaticMarkup(<DamagedNote feed="f" id="n1" back="/f" />);
  expect(owner).toContain("This note can&#x27;t be shown: its stored copy can&#x27;t be decrypted.");
  expect(owner).toContain("Delete this note");
  expect(owner).toContain('href="/f"');
  const reader = renderToStaticMarkup(<DamagedNote id="n1" back="/r/rid" />);
  expect(reader).not.toContain("Delete");
  expect(reader).toContain('href="/r/rid"');
});

test("a page that failed on an unreachable key service is the maintenance page, on both error pages", () => {
  const down = Object.assign(new Error("the key service is unreachable"), { digest: UNAVAILABLE_DIGEST });
  for (const html of [renderToStaticMarkup(<ErrorBoundary error={down} retry={() => {}} />), renderToStaticMarkup(<GlobalError error={down} retry={() => {}} />)]) {
    expect(html).toContain("Down for maintenance");
    expect(html).toContain(MAINTENANCE);
    expect(html).toContain("Try again");
    expect(html).not.toContain("Reference for the operator");
  }
});
