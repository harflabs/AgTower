import { Route, Routes } from "react-router";
import AppShell from "@/components/app-shell";
import Dashboard from "@/pages/dashboard";
import NewSession from "@/pages/new-session";
import Onboarding from "@/pages/onboarding";
import Session from "@/pages/session";
import Settings from "@/pages/settings";

export default function AppRouter() {
  return (
    <Routes>
      <Route path="onboarding" element={<Onboarding />} />
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="session/new" element={<NewSession />} />
        <Route path="session/:id" element={<Session />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
