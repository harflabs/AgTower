import { AppInitProvider } from "@/components/app-init-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { MotionProvider } from "@/components/motion-provider";
import { ThemeProvider } from "@/components/theme-provider";
import AppRouter from "@/router";

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MotionProvider>
          <AppInitProvider>
            <AppRouter />
          </AppInitProvider>
        </MotionProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
