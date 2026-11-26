import { ANALYTICS_APP, HW_EVENTS_MASK, HW_LOADER_SRC } from "@/lib/analytics";

/**
 * The analytics tag, rendered once in the root layout's <head> on every page:
 * <script defer src="/hw-loader.js" data-app="upvoteme" data-mask="/t/ /a/ /T/ /A/">.
 * The loader inserts /hw-events.js with the same attributes, on a canonical
 * path and not on the not-found page (public/hw-loader.js). The root layout is
 * never remounted, so this runs once per page load; the script counts
 * client-side navigations itself (history API).
 */
export function HwEventsScript() {
  return <script defer src={HW_LOADER_SRC} data-app={ANALYTICS_APP} data-mask={HW_EVENTS_MASK} />;
}
