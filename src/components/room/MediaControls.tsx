"use client";

import type { UseWebRtcResult } from "@/hooks/useWebRTC";

export function MediaControls({
  webrtc,
}: {
  webrtc: Pick<UseWebRtcResult, "cameraOn" | "micOn" | "toggleCamera" | "toggleMic">;
}) {
  return (
    <div>
      <button type="button" onClick={webrtc.toggleCamera}>
        {webrtc.cameraOn ? "Turn camera off" : "Turn camera on"}
      </button>
      <button type="button" onClick={webrtc.toggleMic}>
        {webrtc.micOn ? "Mute microphone" : "Unmute microphone"}
      </button>
    </div>
  );
}
