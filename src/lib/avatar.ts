export const AVATAR_COLORS = [
  { bg: "bg-red-500/15", text: "text-red-400", ring: "ring-red-500/30" },
  { bg: "bg-rose-500/15", text: "text-rose-400", ring: "ring-rose-500/30" },
  { bg: "bg-orange-500/15", text: "text-orange-400", ring: "ring-orange-500/30" },
  { bg: "bg-amber-500/15", text: "text-amber-400", ring: "ring-amber-500/30" },
  { bg: "bg-red-400/15", text: "text-red-300", ring: "ring-red-400/30" },
  { bg: "bg-pink-500/15", text: "text-pink-400", ring: "ring-pink-400/30" },
  { bg: "bg-red-700/20", text: "text-red-500", ring: "ring-red-700/30" },
  { bg: "bg-orange-600/15", text: "text-orange-300", ring: "ring-orange-600/30" },
] as const;

export function avatarColor(colorIndex: number) {
  return AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
