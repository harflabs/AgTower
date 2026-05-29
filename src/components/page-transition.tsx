import { useLocation } from "react-router";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // Use a STABLE key for session routes so React updates props (session ID)
  // instead of full unmount/remount. Session-to-session navigation stays mounted
  // and the SessionTerminal handles terminal pool reparenting via its own useEffect.
  // Key only changes when switching BETWEEN route types (dashboard/session/settings).
  const routeKey = location.pathname.startsWith("/session/") ? "/session" : location.pathname;

  return (
    <div key={routeKey} className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {children}
    </div>
  );
}
