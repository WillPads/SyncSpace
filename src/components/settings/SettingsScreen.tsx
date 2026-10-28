"use client";

import { LogOut, Lock, type LucideIcon, Sun, UserRound } from "lucide-react";
import { useState } from "react";
import { AppNav } from "@/components/AppNav";
import { AccountSection } from "@/components/settings/AccountSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { Icon } from "@/components/ui/Icon";
import { useSignOut } from "@/hooks/useSignOut";
import { initials } from "@/lib/avatar";
import type { User } from "@/lib/types";

type SectionId = "profile" | "appearance" | "account";

// Only the sections the app can really do. The mockup also lists audio/video devices, Pomodoro and
// quiz defaults and notifications; none of those exist on the server or in the room yet.
const SECTIONS: { id: SectionId; label: string; title: string; text: string; icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", title: "Profile", text: "Your name and email.", icon: UserRound },
  { id: "appearance", label: "Appearance", title: "Appearance", text: "Theme and motion. Saved on this device.", icon: Sun },
  { id: "account", label: "Account", title: "Account", text: "Change your password or delete your account.", icon: Lock },
];

/** The Settings screen: a menu tile on the left, one section at a time on the right. */
export function SettingsScreen({ user }: { user: User }) {
  const [section, setSection] = useState<SectionId>("profile");
  const { signOut, pending: signingOut } = useSignOut();
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;

  return (
    <>
      <AppNav user={user} current="settings" />
      <div className="set">
        <nav className="tile snav" aria-label="Settings sections">
          <div className="snav-id">
            <span className="avatar" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <div>
              <b>{user.displayName}</b>
              <small>{user.email}</small>
            </div>
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className="snav-btn"
              type="button"
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              <Icon icon={s.icon} size={18} />
              {s.label}
            </button>
          ))}
          <div className="snav-foot">
            <button
              className="snav-btn"
              type="button"
              aria-disabled={signingOut || undefined}
              onClick={() => {
                if (!signingOut) void signOut();
              }}
            >
              <Icon icon={LogOut} size={18} />
              Log out
            </button>
          </div>
        </nav>

        <main className="sbody">
          <header className="sh">
            <h1>{active.title}</h1>
            <p className="set-muted">{active.text}</p>
          </header>
          {section === "profile" && <ProfileSection user={user} />}
          {section === "appearance" && <AppearanceSection />}
          {section === "account" && <AccountSection />}
        </main>
      </div>
    </>
  );
}
