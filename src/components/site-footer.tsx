/**
 * The shared HintWise "built by" footer, the same one every HintWise app
 * carries. Its single source is claude-built-apps scripts/site-footer.mjs:
 * this is footerHtml("upvoteme") from there, byte for byte (the test checks
 * its sha256). Do not edit it here; when the owner changes the wording, copy
 * the new output in.
 *
 * It is a declarative shadow root, so the app's CSS cannot restyle it and
 * its CSS cannot leak out. The browser builds the shadow root while parsing
 * the server HTML; the wrapper is display: contents so the footer is laid out
 * as a child of <body>.
 */
export const SITE_FOOTER_SHA256 = "3a0c0b60a388ccc8a4add52271b9ff148ca6cb19b594e7a23fc7fd3f5472ac8b";

export const SITE_FOOTER_HTML = "<site-footer data-site-footer><template shadowrootmode=\"open\"><style>:host { display: block; box-sizing: border-box; width: 100%; grid-column: 1 / -1; align-self: stretch; clear: both; } aside { box-sizing: border-box; max-width: 46rem; margin: 2.5rem auto 0; padding: 1rem 16px 1.5rem; border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent); font: 13px/1.55 system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif; text-align: center; overflow-wrap: anywhere; } p { margin: 0; } .nb { white-space: nowrap; } p + p { margin-top: 0.4em; } a { color: inherit; text-decoration: underline; text-underline-offset: 2px; } a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; } @media print { :host { display: none; } }</style><aside aria-label=\"About the builder\"><p>HintWise builds tools like this for small businesses, startups and educators.<br>Built with Claude, guided by experts.<br>Want something like this for your own work? <span class=\"nb\">Email <a href=\"mailto:builder@hintwise.org?subject=Project%20idea%20(via%20upvoteme)\">builder@hintwise.org</a>.</span><br>Paid projects welcome, <span class=\"nb\">interesting ones may be done for free&nbsp;:-)</span><br>Academic page: <a href=\"https://pisanorg.github.io/yusuf/\">https://pisanorg.github.io/yusuf/</a><br>More apps: <a href=\"https://studio.hintwise.org/\">studio.hintwise.org</a></p><p>Yusuf Pisan, Chief Education Officer, HintWise</p></aside></template></site-footer>";

export function SiteFooter() {
  return <div className="contents" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SITE_FOOTER_HTML }} />;
}
