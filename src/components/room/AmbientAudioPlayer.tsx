"use client";

import { CloudRain, Coffee, Waves, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useAmbientAudio, type AmbientTrackId } from "@/hooks/useAmbientAudio";
import { cn } from "@/lib/cn";

const TRACK_ICON: Record<AmbientTrackId, LucideIcon> = {
  rain: CloudRain,
  "coffee-shop": Coffee,
  "white-noise": Waves,
};

export function AmbientAudioPlayer() {
  const { tracks, toggle, setVolume } = useAmbientAudio();

  return (
    <Card className="flex flex-col gap-1 p-5">
      <h2 className="mb-2 px-1 text-sm font-medium text-foreground">Ambient sound</h2>
      <p className="mb-2 px-1 text-xs text-muted">
        Layer in a soundscape while you work. Generated live in your browser.
      </p>
      <div className="flex flex-col gap-2">
        {tracks.map((track) => {
          const Icon = TRACK_ICON[track.id];
          return (
            <div
              key={track.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
                track.isPlaying ? "border-primary/40 bg-primary/5" : "border-border bg-transparent"
              )}
            >
              <button
                type="button"
                onClick={() => toggle(track.id)}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  track.isPlaying ? "bg-primary text-white" : "bg-surface-raised text-muted"
                )}
                aria-pressed={track.isPlaying}
                aria-label={`Toggle ${track.label}`}
              >
                <Icon className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{track.label}</p>
                <p className="truncate text-xs text-muted">{track.description}</p>
              </div>
              {track.isPlaying && (
                <div className="flex h-5 shrink-0 items-end gap-0.5" aria-hidden>
                  <span className="h-full w-0.5 animate-eq rounded-full bg-primary [animation-delay:-0.4s]" />
                  <span className="h-full w-0.5 animate-eq rounded-full bg-primary [animation-delay:-0.1s]" />
                  <span className="h-full w-0.5 animate-eq rounded-full bg-primary [animation-delay:-0.3s]" />
                </div>
              )}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={track.volume}
                onChange={(event) => setVolume(track.id, Number(event.target.value))}
                className="h-1 w-16 shrink-0 cursor-pointer accent-red-500"
                aria-label={`${track.label} volume`}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
