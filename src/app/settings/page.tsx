"use client";

import { RequireAuth } from "@/components/RequireAuth";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { AppBackdrop } from "@/components/ui/Backdrop";

export default function SettingsPage() {
  return (
    // Same wrapper as the dashboard: the redesign root wraps RequireAuth, so the loading and
    // error screens get the new look too.
    <div className="redesign app-screen">
      <AppBackdrop />
      <RequireAuth>{(user) => <SettingsScreen user={user} />}</RequireAuth>
    </div>
  );
}
