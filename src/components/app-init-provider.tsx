import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AppWelcomeIcon } from "@/components/app-welcome-icon";
import { Button } from "@/components/ui/button";
import { useAppInit } from "@/hooks/use-app-init";
import { getWelcomeIconSizes } from "@/lib/welcome-icon";

function AppStartupScreen({ initialRoute }: { initialRoute: string | null }) {
  const [iconSize, setIconSize] = useState(
    () => getWelcomeIconSizes(typeof window === "undefined" ? 1280 : window.innerWidth).intro,
  );

  useEffect(() => {
    const updateIconSize = () => {
      setIconSize(getWelcomeIconSizes(window.innerWidth).intro);
    };

    updateIconSize();
    window.addEventListener("resize", updateIconSize);
    return () => {
      window.removeEventListener("resize", updateIconSize);
    };
  }, []);

  return (
    <div className="app-startup-screen onboarding-canvas">
      <div className="app-startup-screen__panel">
        <div className="app-startup-screen__body">
          <div className="app-startup-screen__stage">
            <div className="app-startup-screen__frame">
              <div className="app-startup-screen__content">
                <div
                  className="app-startup-screen__icon-wrap"
                  style={{ width: iconSize, height: iconSize }}
                >
                  <AppWelcomeIcon
                    alt={initialRoute === "/onboarding" ? "AgTower onboarding" : "AgTower"}
                    className="app-startup-screen__icon-shell"
                    imageClassName="app-startup-screen__icon"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppInitProvider({ children }: { children: React.ReactNode }) {
  const { loading, error, initialRoute } = useAppInit();
  const navigate = useNavigate();
  const location = useLocation();
  const [initialRouteResolved, setInitialRouteResolved] = useState(false);
  const windowReady = useRef(false);

  useLayoutEffect(() => {
    if (loading || error || initialRouteResolved || !initialRoute) {
      return;
    }

    if (location.pathname !== initialRoute) {
      navigate(initialRoute, { replace: true });
      return;
    }

    setInitialRouteResolved(true);
  }, [error, initialRoute, initialRouteResolved, loading, location.pathname, navigate]);

  useEffect(() => {
    if (loading || error) {
      setInitialRouteResolved(false);
    }
  }, [error, loading]);

  useEffect(() => {
    if (loading || error || windowReady.current || !initialRoute) return;
    if (location.pathname !== initialRoute) return;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        invoke("main_window_ready").catch(console.error);
        windowReady.current = true;
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [error, initialRoute, loading, location.pathname]);

  if (loading || (!error && (!initialRoute || !initialRouteResolved))) {
    return <AppStartupScreen initialRoute={initialRoute} />;
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div role="alert" className="mx-6 flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-6 text-destructive" />
          <div className="space-y-1">
            <h1 className="text-sm font-medium text-foreground">AgTower couldn't start</h1>
            <p className="text-sm leading-6 text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCcw className="size-3.5" />
            Reload
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
