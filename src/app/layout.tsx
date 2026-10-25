import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import "@/styles/industry.css";
import "@/styles/theme.css";
import "@/styles/app.css";
import "@/styles/additions.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-barlow-condensed",
});

// Picks the theme before first paint so there's no flash of the wrong mode.
// Same rules as components/ui/ThemeToggle.tsx.
const THEME_SCRIPT = `(function(){var m='system';try{m=JSON.parse(localStorage.getItem('syncspace.mode'))||'system'}catch(e){}var d=m==='dark'||(m==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'forest':'mist')})();`;

export const metadata: Metadata = {
  title: "SyncSpace",
  description: "Co-working rooms with one shared Pomodoro clock.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="forest"
      className={`${barlow.variable} ${barlowCondensed.variable}`}
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
