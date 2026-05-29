import { SetupAssistant } from "@/components/setup-assistant/setup-assistant";
import { useNativeMacOSWindowChrome } from "@/hooks/use-native-macos-window-chrome";
import { useWindowTitle } from "@/hooks/use-window-title";

export default function Onboarding() {
  useWindowTitle("AgTower — Onboarding");
  useNativeMacOSWindowChrome({
    showsSidebarToggle: false,
    subtitle: null,
    title: "Onboarding",
  });

  return <SetupAssistant mode="onboarding" />;
}
