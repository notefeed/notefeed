import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { rich } from "./rich";

test("rich turns **bold** and `code` into elements and leaves the rest as text", () => {
  const html = renderToStaticMarkup(<p>{rich("Tap **Add Shortcut**, then type `my-feed` <b>x</b>.")}</p>);
  expect(html).toBe(
    '<p>Tap <strong class="text-ink">Add Shortcut</strong>, then type <code class="break-all font-mono">my-feed</code> &lt;b&gt;x&lt;/b&gt;.</p>',
  );
});

test("unmatched markers stay as they are", () => {
  expect(renderToStaticMarkup(<p>{rich("a ** b ` c")}</p>)).toBe("<p>a ** b ` c</p>");
});
