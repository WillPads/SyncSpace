import Link from "next/link";
import { useId } from "react";

// The two S curves of the mark, shared by both S strokes. The second copy is mirrored.
const S_PATH = "M 87.29 86.61 A 31.68 31.68 0 0 1 138.81 78.01 L 181.19 121.99 A 31.68 31.68 0 0 0 232.71 113.39";
const MIRROR = "matrix(-1 0 0 1 320 0)";

/**
 * The SyncSpace logo: two overlapping rings with a sideways S in each.
 * Colours come from --logo-a / --logo-b / --logo-s / --logo-lens (theme.css), flat fills only,
 * no gradient, glow or shadow. Decorative: the surrounding link carries the accessible name.
 */
export function BrandMark() {
  // Each copy of the mark needs its own clipPath/mask ids, or several marks on one page would share them.
  const uid = useId().replace(/:/g, "");
  const clipId = `${uid}-clip`;
  const maskId = `${uid}-mask`;

  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="42 28 236 144" focusable="false">
        <defs>
          <clipPath id={clipId}>
            <circle cx="116" cy="100" r="58" />
          </clipPath>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="200">
            <rect width="320" height="200" fill="#fff" />
            <path d={S_PATH} transform={MIRROR} fill="none" stroke="#000" strokeWidth="16" strokeLinecap="round" />
          </mask>
        </defs>
        {/* The lens: the right ring's disc, clipped to the left ring, so only the overlap is filled. */}
        <circle cx="204" cy="100" r="58" clipPath={`url(#${clipId})`} style={{ fill: "var(--logo-lens)" }} />
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="116" cy="100" r="58" strokeWidth="10" style={{ stroke: "var(--logo-a)" }} />
          <circle cx="204" cy="100" r="58" strokeWidth="10" style={{ stroke: "var(--logo-b)" }} />
          {/* Left S is masked where the right S crosses it, which makes the strokes interlock. */}
          <path d={S_PATH} strokeWidth="7" mask={`url(#${maskId})`} style={{ stroke: "var(--logo-s)" }} />
          <path d={S_PATH} strokeWidth="7" transform={MIRROR} style={{ stroke: "var(--logo-s)" }} />
        </g>
      </svg>
    </span>
  );
}

/** The wordmark. `hideNameOnPhones` keeps just the mark in the app nav at narrow widths. */
export function Brand({ href = "/", hideNameOnPhones = false }: { href?: string; hideNameOnPhones?: boolean }) {
  return (
    <Link href={href} className="nav-brand brand brand-link" aria-label="SyncSpace home">
      <BrandMark />
      <span className={hideNameOnPhones ? "brand-name" : undefined}>SyncSpace</span>
    </Link>
  );
}
