import { useId } from "react";

/**
 * Decorative page background shared by the redesigned screens: a dot grid and three outlined
 * rings. Everything is a flat-coloured SVG shape (no gradients). Styles are in styles/base.css
 * (.app-fx), so put it as the first child of an element with the `redesign app-screen` classes.
 */
export function AppBackdrop() {
  // The dot pattern needs an id; useId keeps it unique if two backdrops ever share a page.
  const patternId = `${useId().replace(/:/g, "")}-dots`;
  const ring = (
    <>
      <circle cx="150" cy="200" r="90" />
      <circle cx="250" cy="200" r="90" />
      <circle cx="150" cy="200" r="150" strokeDasharray="2 9" />
      <circle cx="250" cy="200" r="150" strokeDasharray="2 9" />
      <circle cx="200" cy="200" r="196" />
    </>
  );
  return (
    <div className="app-fx" aria-hidden="true">
      <svg className="fx-dots" width="100%" height="100%" focusable="false">
        <defs>
          <pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.2" cy="1.2" r="1.2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {["r1", "r2", "r3"].map((c) => (
        <svg key={c} className={`fx-ring ${c}`} viewBox="0 0 400 400" focusable="false">
          {ring}
        </svg>
      ))}
    </div>
  );
}
