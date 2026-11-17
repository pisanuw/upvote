"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ANALYTICS_APP, HW_EVENTS_SRC, analyticsAllowed, loadHwEvents } from "@/lib/analytics";

/**
 * The analytics tag, rendered once in the root layout's <head>:
 * <script defer src="/hw-events.js" data-app="upvoteme">. The root layout is
 * never remounted, so the script loads once per page load; it counts
 * client-side navigations itself (history API). Whether the server renders
 * the tag is decided by the path the page was loaded on and never changes
 * after that (a script React adds on the client would not run).
 */
export function HwEventsScript() {
  const pathname = usePathname();
  const allowed = analyticsAllowed(pathname);
  const [onLoad] = useState(allowed);

  useEffect(() => {
    if (allowed) loadHwEvents(document);
  }, [allowed]);

  return onLoad ? <script defer src={HW_EVENTS_SRC} data-app={ANALYTICS_APP} /> : null;
}
