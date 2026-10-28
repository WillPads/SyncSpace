import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import "@/styles/industry.css";
import "@/styles/tokens.css";
import "@/styles/theme.css";
import "@/styles/app.css";
import "@/styles/additions.css";
import "@/styles/base.css";
import "@/styles/screens/login.css";
import "@/styles/screens/dashboard.css";
import "@/styles/screens/room.css";
import "@/styles/screens/settings.css";
import "@/styles/screens/signedout.css";
import "@/styles/screens/overview.css";

// Space Grotesk is the UI font; JetBrains Mono is only for timer digits and room codes.
// additions.css maps these variables onto --font-heading / --font-body / --font-mono.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--nf-space-grotesk",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--nf-jetbrains-mono",
});

// Picks the theme before first paint so there's no flash of the wrong mode.
// Same rules as hooks/useThemeMode.ts. It also reads the background-animation choice
// (hooks/useBackgroundMotion.ts): data-fx="off" on <html> is what stops the backdrop rings drifting.
const THEME_SCRIPT = `(function(){var m='system';try{m=JSON.parse(localStorage.getItem('syncspace.mode'))||'system'}catch(e){}var d=m==='dark'||(m==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'forest':'mist');var f=true;try{f=JSON.parse(localStorage.getItem('syncspace.fx'))}catch(e){}if(f===false)document.documentElement.setAttribute('data-fx','off')})();`;

export const metadata: Metadata = {
  title: "SyncSpace",
  description: "Co-working rooms with one shared Pomodoro clock.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="forest"
      className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div id="app">{children}</div>
      </body>
    </html>
  );
}
