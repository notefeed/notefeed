import { expect, test } from "vitest";
import { markdownToHtml } from "./rsshtml";

test("a picture's size from its link reaches the reader as width and height, the link made absolute (#243)", () => {
  const { html, image } = markdownToHtml("![shot](shot.png#width=480&height=270)", "https://n.test/r/rid/");
  expect(html).toContain('<img src="https://n.test/r/rid/shot.png" alt="shot" width="480" height="270">');
  expect(image).toBe("https://n.test/r/rid/shot.png");
});

test("a code block keeps its language as a class", () => {
  expect(markdownToHtml("```yaml\na: 1\n```", "https://n.test/r/rid/").html).toMatch(/<code class="[^"]*\blanguage-yaml"/);
});

test("code with a language is highlighted as on the page; without one, or one it doesn't know, it stays plain (#243)", () => {
  const { html } = markdownToHtml("```yaml\nkey: value # note\n```\n\n```\nplain\n```\n\n```mermaid\ngraph TD; A-->B\n```", "https://n.test/r/rid/");
  expect(html).toContain('<code class="hljs language-yaml"><span class="hljs-attr">key:</span>');
  expect(html).toContain('<span class="hljs-comment"># note</span>');
  expect(html).toContain("<pre><code>plain\n</code></pre>");
  expect(html).toContain('<code class="hljs language-mermaid">graph TD; A-->B'); // not a language it knows: left for the page to draw
});
