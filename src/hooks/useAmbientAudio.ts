"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AmbientTrackId = "rain" | "coffee-shop" | "white-noise";

interface TrackDefinition {
  id: AmbientTrackId;
  label: string;
  description: string;
}

export interface AmbientTrackState extends TrackDefinition {
  isPlaying: boolean;
  volume: number;
}

interface TrackNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
  lfo?: OscillatorNode;
}

export const AMBIENT_TRACKS: TrackDefinition[] = [
  { id: "rain", label: "Rain", description: "Steady rainfall hush" },
  { id: "coffee-shop", label: "Coffee Shop", description: "Low murmur & warmth" },
  { id: "white-noise", label: "White Noise", description: "Flat, even hiss" },
];

const DEFAULT_VOLUME = 0.5;
const FADE_SECONDS = 0.6;

function createNoiseBuffer(context: AudioContext, seconds = 4): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function buildTrackGraph(context: AudioContext, id: AmbientTrackId): TrackNodes {
  const source = context.createBufferSource();
  source.buffer = createNoiseBuffer(context);
  source.loop = true;

  const gain = context.createGain();
  gain.gain.value = 0;

  let lastNode: AudioNode = source;
  let lfo: OscillatorNode | undefined;

  if (id === "rain") {
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 700;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 5200;
    lastNode.connect(highpass);
    highpass.connect(lowpass);
    lastNode = lowpass;

    lfo = context.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();
  } else if (id === "coffee-shop") {
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1100;
    const peaking = context.createBiquadFilter();
    peaking.type = "peaking";
    peaking.frequency.value = 350;
    peaking.Q.value = 0.7;
    peaking.gain.value = 5;
    lastNode.connect(lowpass);
    lowpass.connect(peaking);
    lastNode = peaking;

    lfo = context.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();
  }

  lastNode.connect(gain);
  gain.connect(context.destination);
  source.start();

  return { source, gain, lfo };
}

export function useAmbientAudio() {
  const contextRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<Partial<Record<AmbientTrackId, TrackNodes>>>({});
  const [playing, setPlaying] = useState<Record<AmbientTrackId, boolean>>({
    rain: false,
    "coffee-shop": false,
    "white-noise": false,
  });
  const [volumes, setVolumes] = useState<Record<AmbientTrackId, number>>({
    rain: DEFAULT_VOLUME,
    "coffee-shop": DEFAULT_VOLUME,
    "white-noise": DEFAULT_VOLUME,
  });

  const ensureTrack = useCallback((id: AmbientTrackId): TrackNodes => {
    if (!contextRef.current) {
      contextRef.current = new AudioContext();
    }
    const context = contextRef.current;
    if (context.state === "suspended") {
      void context.resume();
    }
    let nodes = nodesRef.current[id];
    if (!nodes) {
      nodes = buildTrackGraph(context, id);
      nodesRef.current[id] = nodes;
    }
    return nodes;
  }, []);

  const toggle = useCallback(
    (id: AmbientTrackId) => {
      const nodes = ensureTrack(id);
      const context = contextRef.current!;
      const willPlay = !playing[id];
      const target = willPlay ? volumes[id] : 0;
      const now = context.currentTime;
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.linearRampToValueAtTime(target, now + FADE_SECONDS);
      setPlaying((prev) => ({ ...prev, [id]: willPlay }));
    },
    [ensureTrack, playing, volumes]
  );

  const setVolume = useCallback(
    (id: AmbientTrackId, value: number) => {
      setVolumes((prev) => ({ ...prev, [id]: value }));
      const nodes = nodesRef.current[id];
      const context = contextRef.current;
      if (nodes && context && playing[id]) {
        const now = context.currentTime;
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.linearRampToValueAtTime(value, now + 0.15);
      }
    },
    [playing]
  );

  useEffect(() => {
    const nodes = nodesRef.current;
    const context = contextRef.current;
    return () => {
      for (const track of Object.values(nodes)) {
        track?.source.stop();
        track?.lfo?.stop();
      }
      void context?.close();
    };
  }, []);

  const tracks: AmbientTrackState[] = AMBIENT_TRACKS.map((def) => ({
    ...def,
    isPlaying: playing[def.id],
    volume: volumes[def.id],
  }));

  return { tracks, toggle, setVolume };
}
