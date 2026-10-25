import type { LucideIcon } from "lucide-react";

/** Lucide at stroke-width 1.5, as the design system asks. */
export function Icon({ icon: Glyph, size = 16, className }: { icon: LucideIcon; size?: number; className?: string }) {
  return <Glyph size={size} strokeWidth={1.5} aria-hidden className={className ? `icon ${className}` : "icon"} />;
}
