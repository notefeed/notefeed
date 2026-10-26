import { expect, test } from "vitest";
import { markdownToHtml } from "./rsshtml";

test("a picture's size from its link reaches the reader as width and height, the link made absolute (#243)", () => {
  const { html, image } = markdownToHtml("![shot](shot.png#width=480&height=270)", "https://n.test/r/rid/");
  expect(html).toContain('<img src="https://n.test/r/rid/shot.png" alt="shot" width="480" height="270">');
  expect(image).toBe("https://n.test/r/rid/shot.png");
});

test("a code block keeps its language as a class", () => {
  expect(markdownToHtml("```yaml\na: 1\n```", "https://n.test/r/rid/").html).toContain('<code class="language-yaml">');
});
