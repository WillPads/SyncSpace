"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getServerWsUrl, patchRoomMedia } from "@/lib/serverConfig";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type SignalingMessage =
  | { type: "presence:sync"; onlineUserIds: string[] }
  | { type: "presence:joined" | "presence:left"; userId: string }
  | { type: "webrtc:offer" | "webrtc:answer" | "webrtc:ice-candidate"; from: string; payload: unknown }
  | { type: "room:update"; room: unknown };

export type WebRtcConnectionState = "idle" | "connecting" | "connected" | "error";

export interface UseWebRtcResult {
  connectionState: WebRtcConnectionState;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  cameraOn: boolean;
  micOn: boolean;
  toggleCamera: () => void;
  toggleMic: () => void;
}

/**
 * Mesh WebRTC over the room's existing sync WebSocket (server/src/ws/index.ts relays
 * webrtc:offer/answer/ice-candidate by target userId). Only the newly-joined peer offers
 * to everyone already online (from presence:sync) - already-present peers just answer -
 * so each pair negotiates exactly once with no offer/offer glare.
 */
export function useWebRTC(roomId: string | null, currentUserId: string | null): UseWebRtcResult {
  const [connectionState, setConnectionState] = useState<WebRtcConnectionState>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const upsertRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => new Map(prev).set(peerId, stream));
  }, []);

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const getOrCreatePeer = useCallback(
    (peerId: string): RTCPeerConnection => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(peerId, pc);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({ type: "webrtc:ice-candidate", to: peerId, payload: event.candidate.toJSON() });
        }
      };

      pc.ontrack = (event) => {
        if (event.streams[0]) upsertRemoteStream(peerId, event.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          removeRemoteStream(peerId);
        }
      };

      return pc;
    },
    [send, upsertRemoteStream, removeRemoteStream]
  );

  const closePeer = useCallback(
    (peerId: string) => {
      peersRef.current.get(peerId)?.close();
      peersRef.current.delete(peerId);
      removeRemoteStream(peerId);
    },
    [removeRemoteStream]
  );

  const initiateOffer = useCallback(
    async (peerId: string) => {
      const pc = getOrCreatePeer(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "webrtc:offer", to: peerId, payload: offer });
    },
    [getOrCreatePeer, send]
  );

  const handleOffer = useCallback(
    async (fromPeerId: string, offer: RTCSessionDescriptionInit) => {
      const pc = getOrCreatePeer(fromPeerId);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: "webrtc:answer", to: fromPeerId, payload: answer });
    },
    [getOrCreatePeer, send]
  );

  const handleAnswer = useCallback(async (fromPeerId: string, answer: RTCSessionDescriptionInit) => {
    await peersRef.current.get(fromPeerId)?.setRemoteDescription(answer);
  }, []);

  const handleIceCandidate = useCallback(async (fromPeerId: string, candidate: RTCIceCandidateInit) => {
    try {
      await peersRef.current.get(fromPeerId)?.addIceCandidate(candidate);
    } catch {
      // Candidates that arrive before the remote description is set are safe to drop.
    }
  }, []);

  useEffect(() => {
    if (!roomId || !currentUserId) return;

    let cancelled = false;
    setConnectionState("connecting");

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);

        const ws = new WebSocket(`${getServerWsUrl()}/ws?roomId=${encodeURIComponent(roomId)}`);
        wsRef.current = ws;

        ws.onopen = () => setConnectionState("connected");
        ws.onerror = () => setConnectionState("error");
        ws.onclose = () => setConnectionState("idle");

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data as string) as SignalingMessage;

          if (message.type === "presence:sync") {
            message.onlineUserIds
              .filter((id) => id !== currentUserId)
              .forEach((peerId) => void initiateOffer(peerId));
          } else if (message.type === "presence:left") {
            closePeer(message.userId);
          } else if (message.type === "webrtc:offer") {
            void handleOffer(message.from, message.payload as RTCSessionDescriptionInit);
          } else if (message.type === "webrtc:answer") {
            void handleAnswer(message.from, message.payload as RTCSessionDescriptionInit);
          } else if (message.type === "webrtc:ice-candidate") {
            void handleIceCandidate(message.from, message.payload as RTCIceCandidateInit);
          }
        };
      })
      .catch(() => setConnectionState("error"));

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
      // peersRef is a mutable store filled by signaling messages after setup, not a DOM ref -
      // re-reading .current here (rather than a captured snapshot) is intentional.
      peersRef.current.forEach((pc) => pc.close());
      // eslint-disable-next-line react-hooks/exhaustive-deps
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStreams(new Map());
      setConnectionState("idle");
    };
  }, [roomId, currentUserId, initiateOffer, closePeer, handleOffer, handleAnswer, handleIceCandidate]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOn;
    setCameraOn(next);
    localStreamRef.current?.getVideoTracks().forEach((track) => (track.enabled = next));
    if (roomId) void patchRoomMedia(roomId, { cameraOn: next });
  }, [cameraOn, roomId]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => (track.enabled = next));
    if (roomId) void patchRoomMedia(roomId, { micOn: next });
  }, [micOn, roomId]);

  return { connectionState, localStream, remoteStreams, cameraOn, micOn, toggleCamera, toggleMic };
}
