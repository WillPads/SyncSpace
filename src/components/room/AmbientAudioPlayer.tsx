"use client";

import { CloudRain, Coffee, Waves, type LucideIcon } from "lucide-react";
import { Corners } from "@/components/ui/Corners";
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
    <div className="card blueprint side-card">
      <Corners />
      <span className="card-title">Ambient sound</span>
      <p className="side-note">Generated in your browser. Only you hear it.</p>
      <div className="sound-list">
        {tracks.map((track) => (
          <div className={cn("sound-row", track.isPlaying && "is-on")} key={track.id}>
            <button
              type="button"
              className={cn("btn btn-icon", track.isPlaying ? "btn-primary" : "btn-secondary")}
              onClick={() => toggle(track.id)}
              aria-pressed={track.isPlaying}
              aria-label={`${track.isPlaying ? "Stop" : "Play"} ${track.label}`}
            >
              <Icon icon={TRACK_ICON[track.id]} />
            </button>
            <span className="sound-text">
              <b>{track.label}</b>
              <span>{track.description}</span>
            </span>
            <input
              type="range"
              className="sound-vol"
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
    </div>
  );
}
