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
export const HW_EVENTS_SHA256 = "d2833162b9f18f9f2fdb36dbd62440c13ee26c6600200d8e55ad32b907f00633";

/**
 * Topic (/t/<code>) and admin (/a/<adminCode>) addresses are the access code.
 * The script's id rule misses many of these codes (an all-letter code, or one
 * with a single digit, looks like a word to it), so data-mask makes it send
 * the segment after each prefix as ":id" whatever it looks like. The script
 * matches prefixes as written, so the upper-case forms are listed too: a
 * mistyped /T/<code> or /A/<code> reaches the not-found page, which carries
 * the tag like every page. So do the percent-encoded forms of all four
 * (/%74/, /%61/, /%54/, /%41/): a hand-crafted /%61/<code> also reaches the
 * not-found page, and location.pathname keeps the encoded prefix, so without
 * them the code would be sent as it is. Each letter has exactly one encoded
 * form (its hex digits are all numbers).
 */
export const HW_EVENTS_MASK = "/t/ /a/ /T/ /A/ /%74/ /%61/ /%54/ /%41/";

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    hintwise?: { track: (name: string, props?: Props, value?: number) => void };
  }
}

/**
 * An app event: a lower_snake_case name and short scalar props, never user content or ids.
 * Never throws: it runs just before sign-in requests and the Google redirect.
 */
export function track(name: string, props?: Props): void {
  if (typeof window === "undefined") return;
  try {
    window.hintwise?.track?.(name, props);
  } catch {
    // Counting must never stop the page from working.
  }
}
