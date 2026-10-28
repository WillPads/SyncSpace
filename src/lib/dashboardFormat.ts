// Small formatting and validation helpers for the dashboard tiles. Times use the browser's own
// time zone and locale, because the server only stores UTC instants.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // the server rejects anything bigger
const UPLOAD_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown"];
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.join(",");
export const UPLOAD_HINT = "PDF, TXT or MD, up to 4 MB";

/** Returns why a file can't be uploaded, or null when it is fine. Mirrors the server's checks. */
export function uploadProblem(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(extension)) return `${file.name}: only PDF, TXT or MD files can be uploaded.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name}: files can be 4 MB at most.`;
  return null;
}

export function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "just now", "5 min ago", "3 h ago", or a short date for anything older than a day. */
export function timeAgo(iso: string, now: number): string {
  const diffSec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const timeOfDay = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(date: Date, now: number): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(date) - start(new Date(now))) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** e.g. "Tomorrow, 7:00 PM – 9:00 PM". */
export function sessionWhen(startsAtIso: string, durationMin: number, now: number): string {
  const start = new Date(startsAtIso);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return `${dayLabel(start, now)}, ${timeOfDay(start)} – ${timeOfDay(end)}`;
}

export function sessionEndsAt(startsAtIso: string, durationMin: number): number {
  return new Date(startsAtIso).getTime() + durationMin * 60_000;
}

/** The browser's time zone name (e.g. "Asia/Manila"), shown next to the schedule form. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Local `YYYY-MM-DD` and `HH:mm`, the formats <input type="date"> and <input type="time"> use. */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function toTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
