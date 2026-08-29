"use client";

import { VideoTile } from "@/components/room/VideoTile";
import type { UseWebRtcResult } from "@/hooks/useWebRTC";

export function VideoGrid({
  webrtc,
  participantNames,
}: {
  webrtc: Pick<UseWebRtcResult, "localStream" | "remoteStreams">;
  participantNames: Record<string, string>;
}) {
  return (
    <div>
      <VideoTile stream={webrtc.localStream} label="You" muted />
      {[...webrtc.remoteStreams.entries()].map(([peerId, stream]) => (
        <VideoTile key={peerId} stream={stream} label={participantNames[peerId] ?? peerId} />
      ))}
    </div>
  );
}
