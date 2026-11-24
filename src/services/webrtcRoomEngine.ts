import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";
import {
  SlidingWindowRateLimiter,
  isPrototypeSafeObject,
  sanitizeSafeText,
} from "@/domain/securityGuard";

export interface RoomParticipant {
  id: string;
  peerJsId?: string;
  name: string;
  role: "HOST" | "PARTICIPANT";
  isLocal: boolean;
  isSimulated?: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  isSpeaking: boolean;
  avatarColor: string;
  joinedAtIso: string;
  stream?: MediaStream | null;
}

export interface RoomChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isPinned?: boolean;
  isAiNote?: boolean;
}

export interface RoomCaptionEntry {
  id: string;
  speakerName: string;
  text: string;
  timestamp: string;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  senderName: string;
  leftPercent: number;
}

export type RoomSignalPayload =
  | {
      type: "PEER_ANNOUNCE";
      participant: Omit<RoomParticipant, "stream" | "isLocal">;
      isReply?: boolean;
    }
  | {
      type: "ROSTER_SYNC";
      participants: Array<Omit<RoomParticipant, "stream" | "isLocal">>;
      roomLocked?: boolean;
    }
  | {
      type: "PEER_STATE_UPDATE";
      participantId: string;
      patch: Partial<Omit<RoomParticipant, "stream" | "isLocal">>;
    }
  | {
      type: "MEDIA_SYNC";
      participantId: string;
      hasAudio: boolean;
      hasVideo: boolean;
    }
  | {
      type: "ROOM_LOCK_STATE";
      locked: boolean;
    }
  | {
      type: "ROOM_LOCKED_REJECT";
      reason: string;
    }
  | {
      type: "HOST_MUTE_ALL";
      requestedBy: string;
    }
  | {
      type: "HOST_MUTE_PEER";
      targetParticipantId: string;
      requestedBy: string;
    }
  | { type: "PEER_LEAVE"; participantId: string }
  | { type: "CHAT_MESSAGE"; message: RoomChatMessage }
  | { type: "REACTION"; emoji: string; senderName: string }
  | { type: "CAPTION"; entry: RoomCaptionEntry }
  | {
      type: "WEBRTC_SDP";
      fromId: string;
      toId: string;
      description: RTCSessionDescriptionInit;
    }
  | {
      type: "WEBRTC_ICE";
      fromId: string;
      toId: string;
      candidate: RTCIceCandidateInit;
    };

const AVATAR_COLORS = [
  "#0b57d0",
  "#0f5223",
  "#7c3aed",
  "#b45309",
  "#be123c",
  "#0369a1",
];

/**
 * Multi-STUN + Public Free TURN Relay configuration so WebRTC RTP audio & video
 * traverse Home Wi-Fi, Ethernet, Corporate Firewalls, and Mobile 4G/5G CGNAT reliably.
 */
const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getDeterministicHostPeerId(roomCode: string): string {
  const clean = roomCode.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
  return `freeting-v3-host-${clean}`;
}

function getGuestPeerId(roomCode: string, localId: string): string {
  const cleanRoom = roomCode.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
  const cleanLocal = localId.replace(/[^a-z0-9]/gi, "");
  return `freeting-v3-guest-${cleanRoom}-${cleanLocal}`;
}

/**
 * Dual-Transport Multi-Peer WebRTC Engine (Desktop <-> Mobile Hardened):
 * 1. Maintains a unified persistent 2-track [audio, video] outbound stream so initial
 *    SDP offers/answers ALWAYS negotiate sendrecv audio + video transceivers.
 * 2. Uses transceiver-indexed RTCRtpSender.replaceTrack() for <20ms glitch-free
 *    microphone unmute/mute, camera toggle, mobile front/rear camera flip, and screen share.
 * 3. Prevents PeerJS MediaConnection glare (deterministic single caller per pair)
 *    and automatically recovers stalled/failed ICE connections across Wi-Fi & 4G/5G.
 */
export class FreetingWebRtcRoomEngine {
  private roomCode: string;
  private localId: string;
  private localParticipantMeta: Omit<RoomParticipant, "stream" | "isLocal"> | null =
    null;
  private knownRoster = new Map<
    string,
    Omit<RoomParticipant, "stream" | "isLocal">
  >();
  private roomLocked = false;
  private ipRelayPrivacyMode = false;
  private peerRateLimiter = new SlidingWindowRateLimiter(45, 2000);

  // Transport 1: BroadcastChannel (Same-browser tabs)
  private channel: BroadcastChannel | null = null;
  private localPeerConnections = new Map<string, RTCPeerConnection>();

  // Transport 2: PeerJS (Cross-browser, Desktop <-> Mobile, Wi-Fi <-> 4G/5G)
  private peerInstance: Peer | null = null;
  private dataConnections = new Map<string, DataConnection>();
  private mediaConnections = new Map<string, MediaConnection>();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private isActingHost = false;

  // Media Tracks & Persistent Fallback Generators (never GC'd during call)
  private localStream: MediaStream | null = null;
  private dummyAudioCtx: AudioContext | null = null;
  private dummyAudioOsc: OscillatorNode | null = null;
  private dummyAudioTrack: MediaStreamTrack | null = null;
  private dummyVideoTrack: MediaStreamTrack | null = null;
  private isDisconnecting = false;

  private onSignalCallback: (payload: RoomSignalPayload) => void;
  private onRemoteStreamCallback: (peerId: string, stream: MediaStream) => void;
  private onRoleResolvedCallback?: (role: "HOST" | "PARTICIPANT") => void;

  constructor(options: {
    roomCode: string;
    localId: string;
    onSignal: (payload: RoomSignalPayload) => void;
    onRemoteStream: (peerId: string, stream: MediaStream) => void;
    onRoleResolved?: (role: "HOST" | "PARTICIPANT") => void;
  }) {
    this.roomCode = options.roomCode;
    this.localId = options.localId;
    this.onSignalCallback = options.onSignal;
    this.onRemoteStreamCallback = options.onRemoteStream;
    this.onRoleResolvedCallback = options.onRoleResolved;
  }

  /**
   * Ensures we always have both a fallback silent audio track and a 2x2 black canvas video track
   * so every WebRTC PeerConnection negotiates BOTH m=audio and m=video transceivers upfront.
   */
  private ensureFallbackTracks(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    if (!this.dummyVideoTrack || this.dummyVideoTrack.readyState === "ended") {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#131314";
          ctx.fillRect(0, 0, 4, 4);
        }
        const vStream = canvas.captureStream(1);
        const vTrack = vStream.getVideoTracks()[0] || null;
        if (vTrack) {
          vTrack.enabled = false;
          this.dummyVideoTrack = vTrack;
        }
      } catch {
        // ignore
      }
    }

    if (!this.dummyAudioTrack || this.dummyAudioTrack.readyState === "ended") {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0; // 100% digital silence
          const dest = ctx.createMediaStreamDestination();
          osc.connect(gain);
          gain.connect(dest);
          osc.start();

          const aTrack = dest.stream.getAudioTracks()[0] || null;
          if (aTrack) {
            aTrack.enabled = false;
            this.dummyAudioCtx = ctx;
            this.dummyAudioOsc = osc;
            this.dummyAudioTrack = aTrack;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  private getActiveAudioTrack(): MediaStreamTrack | null {
    const liveRealAudio = this.localStream
      ?.getAudioTracks()
      .find((t) => t.readyState === "live");
    if (liveRealAudio) return liveRealAudio;
    this.ensureFallbackTracks();
    return this.dummyAudioTrack;
  }

  private getActiveVideoTrack(): MediaStreamTrack | null {
    const liveRealVideo = this.localStream
      ?.getVideoTracks()
      .find((t) => t.readyState === "live");
    if (liveRealVideo) return liveRealVideo;
    this.ensureFallbackTracks();
    return this.dummyVideoTrack;
  }

  /**
   * Builds a fresh MediaStream containing BOTH [activeAudioTrack, activeVideoTrack]
   * so SDP Offer/Answer m-lines are 100% symmetric between Desktop and Mobile.
   */
  private buildUnifiedOutboundStream(): MediaStream {
    const composite = new MediaStream();
    const audioTrack = this.getActiveAudioTrack();
    const videoTrack = this.getActiveVideoTrack();
    if (audioTrack) composite.addTrack(audioTrack);
    if (videoTrack) composite.addTrack(videoTrack);
    return composite;
  }

  /**
   * Deterministic rule to avoid glare (two peers calling each other simultaneously):
   * - Between Host and Guest: Guest ALWAYS initiates the PeerJS MediaConnection to Host; Host answers.
   * - Between two Guests in a 3+ mesh: Guest with lexicographically smaller peerJsId initiates.
   */
  private shouldInitiatePeerJsMediaCall(remotePeerJsId: string): boolean {
    if (!this.peerInstance) return false;
    const hostPeerId = getDeterministicHostPeerId(this.roomCode);
    if (this.isActingHost) {
      return false;
    }
    if (remotePeerJsId === hostPeerId) {
      return true;
    }
    return this.peerInstance.id < remotePeerJsId;
  }

  public connect(
    localParticipant: Omit<RoomParticipant, "stream" | "isLocal">,
    stream: MediaStream | null,
    preferHostRole = true,
    ipRelayPrivacyMode = false
  ): void {
    this.isDisconnecting = false;
    this.ipRelayPrivacyMode = ipRelayPrivacyMode;
    this.localParticipantMeta = { ...localParticipant };
    this.localStream = stream;
    this.knownRoster.set(this.localId, this.localParticipantMeta);

    this.ensureFallbackTracks();
    this.initBroadcastChannel();
    this.initPeerJsNetwork(preferHostRole);
  }

  private initBroadcastChannel(): void {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    this.channel = new BroadcastChannel(`freeting_room_${this.roomCode}`);
    this.channel.onmessage = async (event: MessageEvent<unknown>) => {
      if (this.isDisconnecting) return;
      const sanitized = this.sanitizeIncomingSignal(event.data);
      if (!sanitized) return;

      await this.handleIncomingSignal(sanitized, "broadcast");
    };

    if (this.localParticipantMeta) {
      this.broadcastLocalChannel({
        type: "PEER_ANNOUNCE",
        participant: this.localParticipantMeta,
        isReply: false,
      });
    }
  }

  private async initPeerJsNetwork(preferHostRole: boolean): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const PeerModule = await import("peerjs");
      const PeerClass = PeerModule.default || PeerModule.Peer;
      if (!PeerClass || this.isDisconnecting) return;

      const hostPeerId = getDeterministicHostPeerId(this.roomCode);
      const guestPeerId = getGuestPeerId(this.roomCode, this.localId);
      const initialCandidateId = preferHostRole ? hostPeerId : guestPeerId;

      const peer = new PeerClass(initialCandidateId, {
        debug: 0,
        config: {
          iceServers: RTC_ICE_SERVERS,
          iceCandidatePoolSize: 4,
          ...(this.ipRelayPrivacyMode
            ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy }
            : {}),
        },
      });

      peer.on("open", (openedId: string) => {
        if (this.isDisconnecting) {
          peer.destroy();
          return;
        }
        this.peerInstance = peer;
        this.isActingHost = openedId === hostPeerId;

        if (this.localParticipantMeta) {
          const resolvedRole: "HOST" | "PARTICIPANT" = this.isActingHost
            ? "HOST"
            : "PARTICIPANT";
          this.localParticipantMeta = {
            ...this.localParticipantMeta,
            peerJsId: openedId,
            role: resolvedRole,
          };
          this.knownRoster.set(this.localId, this.localParticipantMeta);
          this.onRoleResolvedCallback?.(resolvedRole);
        }

        if (!this.isActingHost) {
          this.connectToRemotePeerJs(hostPeerId);
        }

        // Periodic health & auto-reconnect heartbeat (every 3s) for cross-network stability
        if (this.reconnectTimer) clearInterval(this.reconnectTimer);
        this.reconnectTimer = setInterval(() => {
          if (this.isDisconnecting || !this.peerInstance) return;

          if (!this.isActingHost && !this.dataConnections.has(hostPeerId)) {
            this.connectToRemotePeerJs(hostPeerId);
          }

          // Ensure every open DataConnection also has a healthy MediaConnection
          this.dataConnections.forEach((conn, remotePeerJsId) => {
            if (!conn.open) return;
            const existingCall = this.mediaConnections.get(remotePeerJsId);
            const iceState = existingCall?.peerConnection?.iceConnectionState;
            const isBroken =
              iceState === "failed" ||
              iceState === "closed" ||
              (!existingCall && this.shouldInitiatePeerJsMediaCall(remotePeerJsId));

            if (isBroken) {
              if (existingCall) {
                try {
                  existingCall.close();
                } catch {
                  // ignore
                }
                this.mediaConnections.delete(remotePeerJsId);
              }
              if (this.shouldInitiatePeerJsMediaCall(remotePeerJsId)) {
                this.initiatePeerJsMediaCall(remotePeerJsId);
              }
            }
          });
        }, 3000);
      });

      peer.on("connection", (conn: DataConnection) => {
        this.setupDataConnection(conn);
      });

      peer.on("call", (call: MediaConnection) => {
        if (this.isDisconnecting) {
          call.close();
          return;
        }
        // Anti-Zoombombing: reject media calls from unknown peers while room is locked by Host
        if (this.isActingHost && this.roomLocked) {
          const isAlreadyInRoom = Array.from(this.knownRoster.values()).some(
            (p) => p.peerJsId === call.peer
          );
          if (!isAlreadyInRoom) {
            call.close();
            return;
          }
        }
        const answerStream = this.buildUnifiedOutboundStream();
        call.answer(answerStream);
        this.setupMediaConnection(call);
        // Sync real tracks immediately after answer in case tracks were toggled right as call arrived
        setTimeout(() => this.syncTracksOnPeerConnection(call.peerConnection), 150);
      });

      peer.on("error", (err: { type?: string }) => {
        if (err && err.type === "unavailable-id" && preferHostRole) {
          try {
            peer.destroy();
          } catch {
            // ignore
          }
          if (!this.isDisconnecting) {
            this.initPeerJsNetwork(false);
          }
        }
      });

      peer.on("disconnected", () => {
        if (!this.isDisconnecting && !peer.destroyed) {
          try {
            peer.reconnect();
          } catch {
            // ignore
          }
        }
      });
    } catch {
      // PeerJS unavailable offline; BroadcastChannel remains active
    }
  }

  private connectToRemotePeerJs(remotePeerJsId: string): void {
    if (
      !this.peerInstance ||
      this.isDisconnecting ||
      remotePeerJsId === this.peerInstance.id ||
      this.dataConnections.has(remotePeerJsId)
    ) {
      return;
    }

    try {
      const conn = this.peerInstance.connect(remotePeerJsId, {
        reliable: true,
      });
      this.setupDataConnection(conn);
    } catch {
      // ignore connection error
    }
  }

  private initiatePeerJsMediaCall(remotePeerJsId: string): void {
    if (
      !this.peerInstance ||
      this.isDisconnecting ||
      remotePeerJsId === this.peerInstance.id
    ) {
      return;
    }

    const existing = this.mediaConnections.get(remotePeerJsId);
    if (existing) {
      const state = existing.peerConnection?.iceConnectionState;
      if (state && state !== "failed" && state !== "closed") {
        this.syncTracksOnPeerConnection(existing.peerConnection);
        return;
      }
      try {
        existing.close();
      } catch {
        // ignore
      }
      this.mediaConnections.delete(remotePeerJsId);
    }

    try {
      const outbound = this.buildUnifiedOutboundStream();
      const call = this.peerInstance.call(remotePeerJsId, outbound, {
        metadata: { senderId: this.localId },
      });
      if (call) {
        this.setupMediaConnection(call);
      }
    } catch {
      // ignore
    }
  }

  private setupDataConnection(conn: DataConnection): void {
    conn.on("open", () => {
      if (this.isDisconnecting) {
        conn.close();
        return;
      }

      // Anti-Zoombombing: enforce room lock on newly arriving PeerJS connections
      if (this.isActingHost && this.roomLocked) {
        const isKnownPeer = Array.from(this.knownRoster.values()).some(
          (p) => p.peerJsId === conn.peer
        );
        if (!isKnownPeer) {
          try {
            conn.send({
              type: "ROOM_LOCKED_REJECT",
              reason: "Esta sala está trancada pelo organizador.",
            } satisfies RoomSignalPayload);
          } catch {
            // ignore
          }
          setTimeout(() => {
            try {
              conn.close();
            } catch {
              // ignore
            }
          }, 250);
          return;
        }
      }

      this.dataConnections.set(conn.peer, conn);

      if (this.localParticipantMeta) {
        conn.send({
          type: "PEER_ANNOUNCE",
          participant: this.localParticipantMeta,
          isReply: false,
        } satisfies RoomSignalPayload);
      }

      if (this.isActingHost) {
        conn.send({
          type: "ROSTER_SYNC",
          participants: Array.from(this.knownRoster.values()),
          roomLocked: this.roomLocked,
        } satisfies RoomSignalPayload);
      }

      // Initiate MediaConnection AFTER DataConnection is open so PEER_ANNOUNCE arrives first!
      if (this.shouldInitiatePeerJsMediaCall(conn.peer)) {
        this.initiatePeerJsMediaCall(conn.peer);
      }
    });

    conn.on("data", async (raw: unknown) => {
      if (this.isDisconnecting || !isPrototypeSafeObject(raw)) return;

      // Anti-DoS Rate Limiter & DataChannel Backpressure Guard
      if (!this.peerRateLimiter.allow(conn.peer)) {
        try {
          conn.close();
        } catch {
          // ignore
        }
        return;
      }
      if (conn.dataChannel && conn.dataChannel.bufferedAmount > 524_288) {
        try {
          conn.close();
        } catch {
          // ignore
        }
        return;
      }

      const sanitized = this.sanitizeIncomingSignal(raw);
      if (!sanitized) return;
      await this.handleIncomingSignal(sanitized, "peerjs", conn.peer);
    });

    conn.on("close", () => {
      this.dataConnections.delete(conn.peer);
      const mediaCall = this.mediaConnections.get(conn.peer);
      if (mediaCall) {
        try {
          mediaCall.close();
        } catch {
          // ignore
        }
        this.mediaConnections.delete(conn.peer);
      }
      for (const [pid, meta] of this.knownRoster.entries()) {
        if (meta.peerJsId === conn.peer && pid !== this.localId) {
          this.knownRoster.delete(pid);
          this.onSignalCallback({ type: "PEER_LEAVE", participantId: pid });
          if (this.isActingHost) {
            this.sendToAllPeerJs({ type: "PEER_LEAVE", participantId: pid });
          }
        }
      }
    });
  }

  private resolveParticipantIdByPeerJsId(
    remotePeerJsId: string,
    metadataSenderId?: unknown
  ): string | null {
    for (const [pid, meta] of this.knownRoster.entries()) {
      if (meta.peerJsId === remotePeerJsId) {
        return pid;
      }
    }
    if (typeof metadataSenderId === "string" && metadataSenderId) {
      return metadataSenderId;
    }
    return null;
  }

  private setupMediaConnection(call: MediaConnection): void {
    const previous = this.mediaConnections.get(call.peer);
    if (previous && previous !== call) {
      try {
        previous.close();
      } catch {
        // ignore
      }
    }
    this.mediaConnections.set(call.peer, call);

    const pc = call.peerConnection;
    if (pc) {
      pc.oniceconnectionstatechange = () => {
        if (this.isDisconnecting) return;
        if (pc.iceConnectionState === "failed") {
          try {
            pc.restartIce?.();
          } catch {
            // ignore
          }
        }
      };
    }

    call.on("stream", (remoteStream: MediaStream) => {
      if (this.isDisconnecting) return;
      const matchedId = this.resolveParticipantIdByPeerJsId(
        call.peer,
        call.metadata?.senderId
      );
      if (matchedId) {
        this.onRemoteStreamCallback(matchedId, remoteStream);
      } else {
        // Retry matching if stream arrived a few ms before PEER_ANNOUNCE
        let attempts = 0;
        const retryTimer = setInterval(() => {
          attempts++;
          const resolved = this.resolveParticipantIdByPeerJsId(
            call.peer,
            call.metadata?.senderId
          );
          if (resolved || attempts >= 10 || this.isDisconnecting) {
            clearInterval(retryTimer);
            if (resolved && !this.isDisconnecting) {
              this.onRemoteStreamCallback(resolved, remoteStream);
            }
          }
        }, 250);
      }
    });

    call.on("close", () => {
      if (this.mediaConnections.get(call.peer) === call) {
        this.mediaConnections.delete(call.peer);
      }
    });
  }

  /**
   * Uses RTCRtpTransceivers (falling back to getSenders) so even if a track previously
   * ended or was null, we ALWAYS replace the exact audio & video sender tracks cleanly.
   */
  private syncTracksOnPeerConnection(
    pc: RTCPeerConnection | null | undefined
  ): boolean {
    if (!pc || pc.signalingState === "closed") return false;

    const targetAudio = this.getActiveAudioTrack();
    const targetVideo = this.getActiveVideoTrack();
    let needsRenegotiation = false;

    const replaceForKind = (
      kind: "audio" | "video",
      nextTrack: MediaStreamTrack | null
    ) => {
      if (!nextTrack) return;

      let sender: RTCRtpSender | undefined;
      if (typeof pc.getTransceivers === "function") {
        const transceiver = pc
          .getTransceivers()
          .find(
            (t) =>
              t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind
          );
        if (transceiver) {
          sender = transceiver.sender;
          if (
            transceiver.direction === "recvonly" ||
            transceiver.direction === "inactive"
          ) {
            try {
              transceiver.direction = "sendrecv";
              needsRenegotiation = true;
            } catch {
              // ignore
            }
          }
        }
      }

      if (!sender) {
        sender = pc.getSenders().find((s) => s.track?.kind === kind);
      }

      if (sender) {
        if (sender.track !== nextTrack) {
          sender.replaceTrack(nextTrack).catch(() => {});
        }
      } else {
        try {
          pc.addTrack(nextTrack, this.buildUnifiedOutboundStream());
          needsRenegotiation = true;
        } catch {
          // ignore
        }
      }
    };

    replaceForKind("audio", targetAudio);
    replaceForKind("video", targetVideo);
    this.applyAdaptivePeerQoS(pc);
    return needsRenegotiation;
  }

  /**
   * Dynamically tunes WebRTC RTP sender bitrates, framerates, resolution scaling, and
   * audio network priority based on active room size and screen-sharing state so rooms
   * with many participants + screen share remain smooth and voice never drops.
   */
  private applyAdaptivePeerQoS(pc: RTCPeerConnection | null | undefined): void {
    if (!pc || pc.signalingState === "closed" || typeof pc.getSenders !== "function") {
      return;
    }

    const totalPeers = Math.max(1, this.knownRoster.size);
    const isSharingScreen = Boolean(this.localParticipantMeta?.isScreenSharing);

    let maxVideoBitrate = 1_400_000;
    let maxVideoFramerate = 30;
    let scaleDown = 1;

    if (isSharingScreen) {
      // Prioritize crisp text readability at efficient framerate during screen sharing
      maxVideoBitrate = totalPeers >= 8 ? 1_200_000 : 1_800_000;
      maxVideoFramerate = 15;
      scaleDown = 1;
    } else if (totalPeers >= 10) {
      maxVideoBitrate = 180_000;
      maxVideoFramerate = 15;
      scaleDown = 2.5;
    } else if (totalPeers >= 6) {
      maxVideoBitrate = 320_000;
      maxVideoFramerate = 18;
      scaleDown = 2;
    } else if (totalPeers >= 3) {
      maxVideoBitrate = 650_000;
      maxVideoFramerate = 24;
      scaleDown = 1.5;
    }

    pc.getSenders().forEach((sender) => {
      const kind = sender.track?.kind;
      if (!kind || typeof sender.getParameters !== "function") return;

      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        if (kind === "audio") {
          params.encodings[0].maxBitrate = 48_000;
          (
            params.encodings[0] as RTCRtpEncodingParameters & {
              priority?: string;
              networkPriority?: string;
            }
          ).priority = "high";
          (
            params.encodings[0] as RTCRtpEncodingParameters & {
              priority?: string;
              networkPriority?: string;
            }
          ).networkPriority = "high";
        } else if (kind === "video") {
          if (sender.track && "contentHint" in sender.track) {
            try {
              sender.track.contentHint = isSharingScreen ? "detail" : "motion";
            } catch {
              // ignore
            }
          }
          params.encodings[0].maxBitrate = maxVideoBitrate;
          params.encodings[0].maxFramerate = maxVideoFramerate;
          params.encodings[0].scaleResolutionDownBy = scaleDown;
        }
        sender.setParameters(params).catch(() => {});
      } catch {
        // ignore browser-specific parameter constraints
      }
    });
  }

  public refreshAllPeersQoS(): void {
    this.localPeerConnections.forEach((pc) => this.applyAdaptivePeerQoS(pc));
    this.mediaConnections.forEach((call) =>
      this.applyAdaptivePeerQoS(call.peerConnection)
    );
  }

  /**
   * Valida esquema, tamanhos máximos e caracteres de todo pacote recebido via P2P DataChannel / BroadcastChannel,
   * bloqueando payloads malformados, Prototype Pollution, XSS e pacotes gigantes (OWASP Input Validation).
   */
  private sanitizeIncomingSignal(raw: unknown): RoomSignalPayload | null {
    if (!isPrototypeSafeObject(raw) || typeof raw.type !== "string") {
      return null;
    }

    switch (raw.type) {
      case "PEER_ANNOUNCE": {
        if (!isPrototypeSafeObject(raw.participant)) return null;
        const p = raw.participant;
        const id = sanitizeSafeText(p.id, 64);
        const name = sanitizeSafeText(p.name, 60);
        if (!id || !name) return null;
        return {
          type: "PEER_ANNOUNCE",
          isReply: Boolean(raw.isReply),
          participant: {
            id,
            peerJsId: p.peerJsId ? sanitizeSafeText(p.peerJsId, 96) : undefined,
            name,
            role: p.role === "HOST" ? "HOST" : "PARTICIPANT",
            isSimulated: Boolean(p.isSimulated),
            isMuted: Boolean(p.isMuted),
            isCameraOff: Boolean(p.isCameraOff),
            isScreenSharing: Boolean(p.isScreenSharing),
            isHandRaised: Boolean(p.isHandRaised),
            isSpeaking: Boolean(p.isSpeaking),
            avatarColor: /^#[0-9a-fA-F]{6}$/.test(String(p.avatarColor || ""))
              ? String(p.avatarColor)
              : "#0b57d0",
            joinedAtIso:
              sanitizeSafeText(p.joinedAtIso, 40) || new Date().toISOString(),
          },
        };
      }
      case "ROSTER_SYNC": {
        if (!Array.isArray(raw.participants) || raw.participants.length > 100) {
          return null;
        }
        const sanitizedList: Array<Omit<RoomParticipant, "stream" | "isLocal">> =
          [];
        for (const item of raw.participants) {
          const wrapped = this.sanitizeIncomingSignal({
            type: "PEER_ANNOUNCE",
            participant: item,
          });
          if (wrapped && wrapped.type === "PEER_ANNOUNCE") {
            sanitizedList.push(wrapped.participant);
          }
        }
        return {
          type: "ROSTER_SYNC",
          participants: sanitizedList,
          roomLocked:
            typeof raw.roomLocked === "boolean" ? raw.roomLocked : undefined,
        };
      }
      case "PEER_STATE_UPDATE": {
        const pid = sanitizeSafeText(raw.participantId, 64);
        if (!pid || !isPrototypeSafeObject(raw.patch)) return null;
        const patch: Partial<Omit<RoomParticipant, "stream" | "isLocal">> = {};
        if (typeof raw.patch.isMuted === "boolean")
          patch.isMuted = raw.patch.isMuted;
        if (typeof raw.patch.isCameraOff === "boolean")
          patch.isCameraOff = raw.patch.isCameraOff;
        if (typeof raw.patch.isScreenSharing === "boolean")
          patch.isScreenSharing = raw.patch.isScreenSharing;
        if (typeof raw.patch.isHandRaised === "boolean")
          patch.isHandRaised = raw.patch.isHandRaised;
        if (typeof raw.patch.isSpeaking === "boolean")
          patch.isSpeaking = raw.patch.isSpeaking;
        if (typeof raw.patch.name === "string")
          patch.name = sanitizeSafeText(raw.patch.name, 60);
        return { type: "PEER_STATE_UPDATE", participantId: pid, patch };
      }
      case "MEDIA_SYNC": {
        const pid = sanitizeSafeText(raw.participantId, 64);
        if (!pid) return null;
        return {
          type: "MEDIA_SYNC",
          participantId: pid,
          hasAudio: Boolean(raw.hasAudio),
          hasVideo: Boolean(raw.hasVideo),
        };
      }
      case "ROOM_LOCK_STATE":
        return { type: "ROOM_LOCK_STATE", locked: Boolean(raw.locked) };
      case "ROOM_LOCKED_REJECT":
        return {
          type: "ROOM_LOCKED_REJECT",
          reason:
            sanitizeSafeText(raw.reason, 160) ||
            "Sala trancada pelo organizador.",
        };
      case "HOST_MUTE_ALL":
        return {
          type: "HOST_MUTE_ALL",
          requestedBy: sanitizeSafeText(raw.requestedBy, 60) || "Organizador",
        };
      case "HOST_MUTE_PEER": {
        const targetId = sanitizeSafeText(raw.targetParticipantId, 64);
        if (!targetId) return null;
        return {
          type: "HOST_MUTE_PEER",
          targetParticipantId: targetId,
          requestedBy: sanitizeSafeText(raw.requestedBy, 60) || "Organizador",
        };
      }
      case "PEER_LEAVE": {
        const pid = sanitizeSafeText(raw.participantId, 64);
        return pid ? { type: "PEER_LEAVE", participantId: pid } : null;
      }
      case "CHAT_MESSAGE": {
        if (!isPrototypeSafeObject(raw.message)) return null;
        const m = raw.message;
        const id = sanitizeSafeText(m.id, 64);
        const senderId = sanitizeSafeText(m.senderId, 64);
        const senderName = sanitizeSafeText(m.senderName, 60);
        const text = sanitizeSafeText(m.text, 2000);
        if (!id || !senderId || !senderName || !text) return null;
        return {
          type: "CHAT_MESSAGE",
          message: {
            id,
            senderId,
            senderName,
            text,
            timestamp: sanitizeSafeText(m.timestamp, 16) || "",
          },
        };
      }
      case "REACTION": {
        const emoji = sanitizeSafeText(raw.emoji, 12);
        const allowedEmojis = new Set(["👍", "❤️", "🎉", "👏", "😂", "😮"]);
        if (!allowedEmojis.has(emoji)) return null;
        return {
          type: "REACTION",
          emoji,
          senderName: sanitizeSafeText(raw.senderName, 60) || "Participante",
        };
      }
      case "CAPTION": {
        if (!isPrototypeSafeObject(raw.entry)) return null;
        const c = raw.entry;
        const id = sanitizeSafeText(c.id, 64);
        const speakerName = sanitizeSafeText(c.speakerName, 60);
        const text = sanitizeSafeText(c.text, 500);
        if (!id || !speakerName || !text) return null;
        return {
          type: "CAPTION",
          entry: {
            id,
            speakerName,
            text,
            timestamp: sanitizeSafeText(c.timestamp, 16) || "",
          },
        };
      }
      case "WEBRTC_SDP": {
        const fromId = sanitizeSafeText(raw.fromId, 64);
        const toId = sanitizeSafeText(raw.toId, 64);
        if (!fromId || !toId || !isPrototypeSafeObject(raw.description))
          return null;
        const sdpType = raw.description.type;
        if (sdpType !== "offer" && sdpType !== "answer") return null;
        const sdp =
          typeof raw.description.sdp === "string"
            ? raw.description.sdp.slice(0, 65_536)
            : "";
        return {
          type: "WEBRTC_SDP",
          fromId,
          toId,
          description: { type: sdpType, sdp },
        };
      }
      case "WEBRTC_ICE": {
        const fromId = sanitizeSafeText(raw.fromId, 64);
        const toId = sanitizeSafeText(raw.toId, 64);
        if (!fromId || !toId || !isPrototypeSafeObject(raw.candidate))
          return null;
        return {
          type: "WEBRTC_ICE",
          fromId,
          toId,
          candidate: raw.candidate as RTCIceCandidateInit,
        };
      }
      default:
        return null;
    }
  }

  /**
   * Verifica autenticidade de comandos privilegiados do Organizador (CWE-290 Anti-Spoofing).
   */
  private isVerifiedHostSignal(
    source: "broadcast" | "peerjs",
    fromPeerJsId?: string
  ): boolean {
    if (source === "peerjs") {
      return fromPeerJsId === getDeterministicHostPeerId(this.roomCode);
    }
    return true;
  }

  private async handleIncomingSignal(
    data: RoomSignalPayload,
    source: "broadcast" | "peerjs",
    fromPeerJsId?: string
  ): Promise<void> {
    if (data.type === "PEER_ANNOUNCE") {
      if (data.participant.id === this.localId) return;

      if (
        data.participant.role === "HOST" &&
        this.localParticipantMeta &&
        this.localParticipantMeta.role === "HOST" &&
        data.isReply
      ) {
        this.isActingHost = false;
        this.localParticipantMeta = {
          ...this.localParticipantMeta,
          role: "PARTICIPANT",
        };
        this.knownRoster.set(this.localId, this.localParticipantMeta);
        this.onRoleResolvedCallback?.("PARTICIPANT");
      }

      this.knownRoster.set(data.participant.id, data.participant);
      this.onSignalCallback(data);

      if (source === "broadcast") {
        if (!data.isReply && this.localParticipantMeta) {
          this.broadcastLocalChannel({
            type: "PEER_ANNOUNCE",
            participant: this.localParticipantMeta,
            isReply: true,
          });
        }
        // Only engage local BroadcastChannel RTCPeerConnection if we don't already have a PeerJS call to this peer
        const peerJsAlreadyConnected =
          !!data.participant.peerJsId &&
          this.mediaConnections.has(data.participant.peerJsId);
        if (!peerJsAlreadyConnected) {
          await this.initiateLocalRtcPeerConnection(
            data.participant.id,
            !data.isReply
          );
        }
      } else if (source === "peerjs") {
        if (this.isActingHost) {
          this.sendToAllPeerJs({
            type: "ROSTER_SYNC",
            participants: Array.from(this.knownRoster.values()),
            roomLocked: this.roomLocked,
          });
        }
        if (
          data.participant.peerJsId &&
          this.shouldInitiatePeerJsMediaCall(data.participant.peerJsId)
        ) {
          this.initiatePeerJsMediaCall(data.participant.peerJsId);
        }
      }
      return;
    }

    if (data.type === "ROSTER_SYNC") {
      if (!this.isVerifiedHostSignal(source, fromPeerJsId)) return;
      if (typeof data.roomLocked === "boolean") {
        this.roomLocked = data.roomLocked;
        this.onSignalCallback({
          type: "ROOM_LOCK_STATE",
          locked: data.roomLocked,
        });
      }
      for (const peerMeta of data.participants) {
        if (peerMeta.id !== this.localId) {
          this.knownRoster.set(peerMeta.id, peerMeta);
          this.onSignalCallback({
            type: "PEER_ANNOUNCE",
            participant: peerMeta,
            isReply: true,
          });
          if (peerMeta.peerJsId) {
            this.connectToRemotePeerJs(peerMeta.peerJsId);
          }
        }
      }
      return;
    }

    if (data.type === "WEBRTC_SDP" && data.toId === this.localId) {
      await this.handleRemoteSdp(data.fromId, data.description);
      return;
    }

    if (data.type === "WEBRTC_ICE" && data.toId === this.localId) {
      await this.handleRemoteIce(data.fromId, data.candidate);
      return;
    }

    if (
      data.type === "ROOM_LOCK_STATE" ||
      data.type === "ROOM_LOCKED_REJECT" ||
      data.type === "HOST_MUTE_ALL" ||
      data.type === "HOST_MUTE_PEER"
    ) {
      if (!this.isVerifiedHostSignal(source, fromPeerJsId)) return;
    }

    if (data.type === "PEER_STATE_UPDATE") {
      const existing = this.knownRoster.get(data.participantId);
      if (existing) {
        // Prevent a non-Host guest from spoofing state updates of other participants (IDOR defense)
        if (
          source === "peerjs" &&
          !this.isVerifiedHostSignal(source, fromPeerJsId) &&
          existing.peerJsId &&
          existing.peerJsId !== fromPeerJsId
        ) {
          return;
        }
        this.knownRoster.set(data.participantId, {
          ...existing,
          ...data.patch,
        });
      }
    } else if (data.type === "ROOM_LOCK_STATE") {
      this.roomLocked = data.locked;
    } else if (data.type === "PEER_LEAVE") {
      const target = this.knownRoster.get(data.participantId);
      if (
        source === "peerjs" &&
        !this.isVerifiedHostSignal(source, fromPeerJsId) &&
        target?.peerJsId &&
        target.peerJsId !== fromPeerJsId
      ) {
        return;
      }
      this.knownRoster.delete(data.participantId);
    }

    if (source === "peerjs" && this.isActingHost) {
      this.sendToAllPeerJs(data, fromPeerJsId);
    }

    this.onSignalCallback(data);
  }

  public setRoomLocked(locked: boolean): void {
    this.roomLocked = locked;
    this.broadcast({ type: "ROOM_LOCK_STATE", locked });
  }

  public requestMuteAll(requestedBy: string): void {
    this.broadcast({ type: "HOST_MUTE_ALL", requestedBy });
  }

  public requestMuteParticipant(
    targetParticipantId: string,
    requestedBy: string
  ): void {
    this.broadcast({
      type: "HOST_MUTE_PEER",
      targetParticipantId,
      requestedBy,
    });
  }

  public updateLocalParticipantMeta(
    patch: Partial<Omit<RoomParticipant, "stream" | "isLocal">>
  ): void {
    if (this.localParticipantMeta) {
      this.localParticipantMeta = { ...this.localParticipantMeta, ...patch };
      this.knownRoster.set(this.localId, this.localParticipantMeta);
    }
    this.broadcast({
      type: "PEER_STATE_UPDATE",
      participantId: this.localId,
      patch,
    });
  }

  /**
   * Synchronizes updated local audio/video/screen tracks across ALL active connections
   * seamlessly using replaceTrack() without dropping existing calls or causing SDP glare.
   */
  public updateLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;

    if (this.dummyAudioCtx && this.dummyAudioCtx.state === "suspended") {
      this.dummyAudioCtx.resume().catch(() => {});
    }

    // 1. Update local BroadcastChannel RTCPeerConnections
    this.localPeerConnections.forEach((pc, remotePeerId) => {
      const needsRenegotiation = this.syncTracksOnPeerConnection(pc);
      if (needsRenegotiation) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            this.broadcastLocalChannel({
              type: "WEBRTC_SDP",
              fromId: this.localId,
              toId: remotePeerId,
              description: offer,
            });
          })
          .catch(() => {});
      }
    });

    // 2. Update PeerJS MediaConnections via transceiver replaceTrack()
    this.mediaConnections.forEach((call) => {
      this.syncTracksOnPeerConnection(call.peerConnection);
    });

    // 3. If any open PeerJS DataConnection lacks a MediaConnection (and we are initiator), establish it
    this.dataConnections.forEach((conn, remotePeerJsId) => {
      if (
        conn.open &&
        !this.mediaConnections.has(remotePeerJsId) &&
        this.shouldInitiatePeerJsMediaCall(remotePeerJsId)
      ) {
        this.initiatePeerJsMediaCall(remotePeerJsId);
      }
    });

    const hasRealAudio = !!stream
      ?.getAudioTracks()
      .some((t) => t.readyState === "live" && t.enabled);
    const hasRealVideo = !!stream
      ?.getVideoTracks()
      .some((t) => t.readyState === "live" && t.enabled);

    this.broadcast({
      type: "MEDIA_SYNC",
      participantId: this.localId,
      hasAudio: hasRealAudio,
      hasVideo: hasRealVideo,
    });
  }

  private async initiateLocalRtcPeerConnection(
    remotePeerId: string,
    isInitiator: boolean
  ): Promise<RTCPeerConnection | null> {
    if (typeof window === "undefined" || !("RTCPeerConnection" in window)) {
      return null;
    }
    if (this.localPeerConnections.has(remotePeerId)) {
      const existingPc = this.localPeerConnections.get(remotePeerId)!;
      this.syncTracksOnPeerConnection(existingPc);
      return existingPc;
    }

    const pc = new RTCPeerConnection({
      iceServers: RTC_ICE_SERVERS,
    });
    this.localPeerConnections.set(remotePeerId, pc);

    const activeStream = this.buildUnifiedOutboundStream();
    activeStream.getTracks().forEach((track) => {
      pc.addTrack(track, activeStream);
    });

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.broadcastLocalChannel({
          type: "WEBRTC_ICE",
          fromId: this.localId,
          toId: remotePeerId,
          candidate: ev.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        this.onRemoteStreamCallback(remotePeerId, ev.streams[0]);
      } else {
        const fallback = new MediaStream([ev.track]);
        this.onRemoteStreamCallback(remotePeerId, fallback);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.broadcastLocalChannel({
          type: "WEBRTC_SDP",
          fromId: this.localId,
          toId: remotePeerId,
          description: offer,
        });
      } catch {
        // ignore negotiation collision
      }
    }

    return pc;
  }

  private async handleRemoteSdp(
    fromId: string,
    description: RTCSessionDescriptionInit
  ): Promise<void> {
    const pc = await this.initiateLocalRtcPeerConnection(fromId, false);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(description));
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.broadcastLocalChannel({
          type: "WEBRTC_SDP",
          fromId: this.localId,
          toId: fromId,
          description: answer,
        });
      }
    } catch {
      // ignore
    }
  }

  private async handleRemoteIce(
    fromId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const pc = this.localPeerConnections.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ignore
    }
  }

  private broadcastLocalChannel(payload: RoomSignalPayload): void {
    try {
      this.channel?.postMessage(payload);
    } catch {
      // ignore
    }
  }

  private sendToAllPeerJs(
    payload: RoomSignalPayload,
    excludePeerJsId?: string
  ): void {
    this.dataConnections.forEach((conn, peerJsId) => {
      if (peerJsId !== excludePeerJsId && conn.open) {
        try {
          conn.send(payload);
        } catch {
          // ignore
        }
      }
    });
  }

  public broadcast(payload: RoomSignalPayload): void {
    this.broadcastLocalChannel(payload);
    this.sendToAllPeerJs(payload);
  }

  public disconnect(): void {
    this.isDisconnecting = true;
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.broadcast({ type: "PEER_LEAVE", participantId: this.localId });

    this.localPeerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    this.localPeerConnections.clear();

    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore
      }
      this.channel = null;
    }

    this.mediaConnections.forEach((call) => {
      try {
        call.close();
      } catch {
        // ignore
      }
    });
    this.mediaConnections.clear();

    this.dataConnections.forEach((conn) => {
      try {
        conn.close();
      } catch {
        // ignore
      }
    });
    this.dataConnections.clear();

    if (this.peerInstance) {
      try {
        this.peerInstance.destroy();
      } catch {
        // ignore
      }
      this.peerInstance = null;
    }

    if (this.dummyAudioOsc) {
      try {
        this.dummyAudioOsc.stop();
      } catch {
        // ignore
      }
      this.dummyAudioOsc = null;
    }
    if (this.dummyAudioTrack) {
      this.dummyAudioTrack.stop();
      this.dummyAudioTrack = null;
    }
    if (this.dummyAudioCtx) {
      this.dummyAudioCtx.close().catch(() => {});
      this.dummyAudioCtx = null;
    }
    if (this.dummyVideoTrack) {
      this.dummyVideoTrack.stop();
      this.dummyVideoTrack = null;
    }
  }
}
