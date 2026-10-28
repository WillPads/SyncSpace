"use client";

import { CloudRain, Coffee, Waves, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
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
    <section className="tile rm-card" aria-labelledby="rm-sound-h">
      <header className="rm-card-head">
        <h2 id="rm-sound-h">Ambient sound</h2>
      </header>
      <p className="rm-desc">Generated in your browser. Only you hear it.</p>
      <div className="rm-sounds">
        {tracks.map((track) => (
          <div className={cn("rm-sound", track.isPlaying && "is-on")} key={track.id}>
            <button
              type="button"
              className={cn("btn btn-icon", track.isPlaying ? "btn-primary" : "btn-secondary")}
              onClick={() => toggle(track.id)}
              aria-pressed={track.isPlaying}
              aria-label={`${track.isPlaying ? "Stop" : "Play"} ${track.label}`}
            >
              <Icon icon={TRACK_ICON[track.id]} />
            </button>
            <span className="rm-sound-text">
              <b>{track.label}</b>
              <span>{track.description}</span>
            </span>
            <input
              type="range"
              className="rm-vol"
              min={0}
              max={1}
              step={0.05}
              value={track.volume}
              onChange={(event) => setVolume(track.id, Number(event.target.value))}
              aria-label={`${track.label} volume`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
