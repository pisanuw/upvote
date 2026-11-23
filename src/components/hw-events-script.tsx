import { ANALYTICS_APP, HW_EVENTS_MASK, HW_EVENTS_SRC } from "@/lib/analytics";

/**
 * The analytics tag, rendered once in the root layout's <head> on every page:
 * <script defer src="/hw-events.js" data-app="upvoteme" data-mask="/t/ /a/ /T/ /A/">.
 * The root layout is never remounted, so the script loads once per page
 * load; it counts client-side navigations itself (history API).
 */
export function HwEventsScript() {
  return <script defer src={HW_EVENTS_SRC} data-app={ANALYTICS_APP} data-mask={HW_EVENTS_MASK} />;
}
