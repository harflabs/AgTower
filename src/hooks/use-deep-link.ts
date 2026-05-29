import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { HAS_TAURI_RUNTIME } from "@/lib/platform";

/**
 * Routes `agtower://` URLs to React Router locations.
 *
 * The deep-link plugin fires `onOpenUrl` for every URL the OS hands us —
 * cold start (app launched via URL), warm re-launch (single-instance
 * plugin forwards the URL args), and `open agtower://...` from Terminal
 * while we're already running. Subscribers receive the full list of URLs
 * that haven't been consumed yet, including anything that arrived before
 * the subscription was registered — so mount timing doesn't matter.
 *
 * MemoryRouter means the URL can't drive navigation on its own; we have
 * to call `navigate()` explicitly from a component that lives inside the
 * router context.
 *
 * Supported:
 *   agtower://                  → just surface the app (Rust already
 *                                 handled the show/focus in on_open_url)
 *   agtower://dashboard         → /
 *   agtower://settings          → /settings
 *   agtower://new-session       → /session/new
 *   agtower://session/new       → /session/new
 *   agtower://session/<id>      → /session/<id>
 *
 * IDs are constrained to `[A-Za-z0-9_-]` to prevent path injection.
 */

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function resolveRoute(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "agtower:") return null;

  // `agtower://host/segment` parses as host=host, pathname=/segment.
  // For a bare `agtower://` the host is "".
  const host = url.hostname.toLowerCase();
  const segment = url.pathname.replace(/^\/+/, "");

  switch (host) {
    case "":
      return null;
    case "dashboard":
      return "/";
    case "settings":
      return "/settings";
    case "new-session":
      return "/session/new";
    case "session": {
      if (segment === "new") return "/session/new";
      if (SESSION_ID.test(segment)) return `/session/${segment}`;
      return null;
    }
    default:
      return null;
  }
}

// URLs-per-event cap. `onOpenUrl` delivers a string[] — an absurdly large one
// would stall the main thread on regex. The OS realistically hands us 1; 8 is
// generous headroom. The cap is a belt-and-braces bound, not an expected case.
const MAX_URLS_PER_EVENT = 8;

export function useDeepLink() {
  // `navigate`'s identity changes on every route transition. If we put it in
  // the effect's dep array, we tear down and re-subscribe on every navigation
  // — and a URL arriving in that tiny gap is lost. Stash in a ref so the
  // handler always sees the latest navigate without re-subscribing.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!HAS_TAURI_RUNTIME) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    onOpenUrl((urls) => {
      // Act on the first routable URL. Batch routing would be a navigation
      // race, and nothing in this app benefits from it.
      for (const url of urls.slice(0, MAX_URLS_PER_EVENT)) {
        const target = resolveRoute(url);
        if (target) {
          navigateRef.current(target);
          return;
        }
        console.warn("[deep-link] Ignoring unroutable URL:", url);
      }
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((err) => {
        console.error("[deep-link] Failed to subscribe:", err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
