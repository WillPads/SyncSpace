// Per-browser preferences (theme, room view, task list). Storage can be missing or
// blocked (private windows), so every access falls back to the in-memory default.
const PREFIX = "syncspace.";

export function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveStored(key: string, value: unknown): void {
  try {
    if (value == null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Keep working in memory.
  }
}
