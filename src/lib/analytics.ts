/**
 * HintWise first-party analytics. public/hw-events.js is the platform's
 * script (claude-built-apps platform/src/analytics/hw-events.js), copied
 * byte for byte: the test pins its sha256. Do not edit the copy; when the
 * platform changes it, copy the new file in and update the hash.
 *
 * It counts visits with no cookie and nothing kept in the browser: the page's
 * path (ids masked), how long it was open, the host of a link followed out,
 * and the events sent with track() below. It sends nothing under Global
 * Privacy Control, Do Not Track or an automated browser.
 */
export const ANALYTICS_APP = "upvoteme";
export const HW_EVENTS_SRC = "/hw-events.js";
export const HW_EVENTS_SHA256 = "fe0b6e92ddd6093e9ba7fa2b9fff32cd68bb5a42e191e9770fda93e5a1ba6227";

/**
 * Topic (/t/<code>) and admin (/a/<adminCode>) pages carry their access code
 * in the path, and the script's id masking misses many of these codes (an
 * all-letter code, or one with a single digit, looks like a word to it), so
 * those pages load no analytics at all. Every other page does.
 */
export function analyticsAllowed(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && !/^\/[ta](\/|$)/.test(pathname);
}

/**
 * Loads the script once per document. The root layout server-renders the tag
 * on pages that allow it; this covers a client-side move from a topic or
 * admin page to one that does (the logo link to the home page).
 */
export function loadHwEvents(doc: Document): void {
  if (doc.querySelector(`script[src="${HW_EVENTS_SRC}"]`)) return;
  const s = doc.createElement("script");
  s.src = HW_EVENTS_SRC;
  s.setAttribute("data-app", ANALYTICS_APP);
  doc.head.appendChild(s);
}

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    hintwise?: { track: (name: string, props?: Props, value?: number) => void };
  }
}

/** An app event: a lower_snake_case name and short scalar props, never user content or ids. */
export function track(name: string, props?: Props): void {
  if (typeof window === "undefined") return;
  window.hintwise?.track(name, props);
}
