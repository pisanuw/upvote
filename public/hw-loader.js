/*
 * hw-loader.js: UpvoteMe's own loader for the platform's /hw-events.js.
 * This file is UpvoteMe's; /hw-events.js stays the platform's file, unchanged.
 *
 *   <script defer src="/hw-loader.js" data-app="upvoteme" data-mask="/t/ /a/ /T/ /A/">
 *
 * It inserts <script src="/hw-events.js"> with the same data-app and data-mask
 * (an inserted script is document.currentScript while it runs), but only when
 *   - the page is not the not-found page (it carries data-hw-not-found), and
 *   - location.pathname is canonical: "/", or segments that are not empty,
 *     contain no "%" and do not end in "." (so no "//" and no trailing "/").
 * The script's data-mask matches path prefixes as written, so on any other
 * form of an address it could not be relied on.
 *
 * The check runs once, on each full page load. After that the script counts
 * every in-app move as it finds it, so every in-app target must be canonical:
 * route params, fixed paths, or safeCallbackUrl. canonical() below is the same
 * rule as isCanonicalPath in src/lib/canonical-path.ts (a test checks that
 * they agree). Likewise, a not-found page opened directly is not counted; one
 * reached by an in-app move is, with the path masked.
 * Deferred, so it runs once the whole page has been parsed.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me) return;

  function canonical(p) {
    if (p === '/') return true;
    if (typeof p !== 'string' || p.charAt(0) !== '/') return false;
    var segs = p.slice(1).split('/');
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === '' || s.indexOf('%') >= 0 || s.charAt(s.length - 1) === '.') return false;
    }
    return true;
  }

  if (document.querySelector('[data-hw-not-found]')) return;
  if (!canonical(location.pathname)) return;

  var s = document.createElement('script');
  s.src = '/hw-events.js';
  ['data-app', 'data-mask'].forEach(function (k) {
    var v = me.getAttribute(k);
    if (v !== null) s.setAttribute(k, v);
  });
  document.head.appendChild(s);
})();
