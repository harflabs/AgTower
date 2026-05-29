import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div role="alert" className="mx-6 flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-6 text-destructive" />
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">Something went wrong</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              An unexpected error occurred. Try reloading the application.
            </p>
          </div>
          {this.state.error && (
            <div className="w-full">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
              >
                {this.state.showDetails ? "Hide details" : "Show details"}
              </Button>
              {this.state.showDetails && (
                <pre
                  data-selection="content"
                  className="native-inset-panel mt-3 max-h-40 overflow-auto p-3 text-left text-xs leading-5 text-muted-foreground"
                >
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              )}
            </div>
          )}
          <Button size="sm" onClick={() => window.location.reload()}>
            <RotateCcw className="size-3.5" />
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
