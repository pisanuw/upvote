import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE_FOOTER_HTML, SITE_FOOTER_SHA256, SiteFooter } from "@/components/site-footer";

describe("SiteFooter", () => {
  it("is footerHtml('upvoteme') from claude-built-apps scripts/site-footer.mjs, byte for byte", () => {
    expect(createHash("sha256").update(SITE_FOOTER_HTML).digest("hex")).toBe(SITE_FOOTER_SHA256);
    expect(SITE_FOOTER_SHA256).toBe("3a0c0b60a388ccc8a4add52271b9ff148ca6cb19b594e7a23fc7fd3f5472ac8b");
  });

  it("renders the markup unescaped, once, in a display: contents wrapper", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter));
    expect(html).toBe(`<div class="contents">${SITE_FOOTER_HTML}</div>`);
    expect(html.split("data-site-footer").length - 1).toBe(1);
    expect(html).toContain('<template shadowrootmode="open">');
    expect(html).toContain("mailto:builder@hintwise.org?subject=Project%20idea%20(via%20upvoteme)");
  });
});
