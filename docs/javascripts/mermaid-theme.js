// Material themes Mermaid with its own CSS (themeCSS), which styles a sequence diagram's lifelines as `line`. Mermaid 11
// styles them as `.actor-line`, which wins, so they came out in Mermaid's default purple. This adds the rule Material lacks,
// with the colour stylesheets/extra.css sets for both light and dark.
(() => {
  if (typeof mermaid === "undefined") return;
  const initialize = mermaid.initialize.bind(mermaid);
  mermaid.initialize = (config) =>
    initialize({ ...config, themeCSS: `${config?.themeCSS ?? ""} .actor-line{stroke:var(--md-mermaid-sequence-actor-line-color)}` });
})();
