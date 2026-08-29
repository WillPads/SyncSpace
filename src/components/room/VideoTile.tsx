"use client";

import { useEffect, useRef } from "react";

export function VideoTile({
  stream,
  label,
  muted = false,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline muted={muted} />
      <span>{label}</span>
    </div>
  );
}
