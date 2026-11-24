import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";

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
    }
  | {
      type: "PEER_STATE_UPDATE";
      participantId: string;
      patch: Partial<Omit<RoomParticipant, "stream" | "isLocal">>;
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

export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getDeterministicHostPeerId(roomCode: string): string {
  const clean = roomCode.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
  return `freeting-v2-host-${clean}`;
}

function getGuestPeerId(roomCode: string, localId: string): string {
  const cleanRoom = roomCode.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
  const cleanLocal = localId.replace(/[^a-z0-9]/gi, "");
  return `freeting-v2-guest-${cleanRoom}-${cleanLocal}`;
}

/**
 * Dual-Transport Multi-Peer WebRTC Engine:
 * 1. PeerJS Cloud Signaling + WebRTC DataChannel/MediaConnection:
 *    Allows participants across different browsers, incognito windows, different computers,
 *    or mobile phones to join the same room code, discover the Host and all peers,
 *    chat in real time, and stream live video & audio.
 * 2. BroadcastChannel + Local RTCPeerConnection:
 *    Provides instant 0ms fallback for multiple tabs within the same browser.
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

  // Transport 1: BroadcastChannel (Same-browser tabs)
  private channel: BroadcastChannel | null = null;
  private localPeerConnections = new Map<string, RTCPeerConnection>();

  // Transport 2: PeerJS (Cross-browser, Incognito, Cross-Device / Internet)
  private peerInstance: Peer | null = null;
  private dataConnections = new Map<string, DataConnection>();
  private mediaConnections = new Map<string, MediaConnection>();
  private isActingHost = false;

  private localStream: MediaStream | null = null;
  private dummyStream: MediaStream | null = null;
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
   * Creates a lightweight 1x1 black canvas video track + silent Web Audio track
   * so both audio and video transceivers are pre-negotiated on initial WebRTC handshake.
   */
  private getOrCreateFallbackStream(): MediaStream | null {
    if (
      this.localStream &&
      this.localStream.getVideoTracks().length > 0 &&
      this.localStream.getAudioTracks().length > 0
    ) {
      return this.localStream;
    }
    if (this.dummyStream) {
      const combined = new MediaStream();
      const realVideo = this.localStream?.getVideoTracks()[0];
      const realAudio = this.localStream?.getAudioTracks()[0];
      const dummyVideo = this.dummyStream.getVideoTracks()[0];
      const dummyAudio = this.dummyStream.getAudioTracks()[0];
      if (realVideo || dummyVideo) combined.addTrack(realVideo || dummyVideo);
      if (realAudio || dummyAudio) combined.addTrack(realAudio || dummyAudio);
      return combined;
    }
    if (typeof document === "undefined") return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext("2d");
      ctx?.fillRect(0, 0, 2, 2);
      const stream = canvas.captureStream(1);

      if (typeof window !== "undefined" && "AudioContext" in window) {
        try {
          const audioCtx = new window.AudioContext();
          const dest = audioCtx.createMediaStreamDestination();
          const silentTrack = dest.stream.getAudioTracks()[0];
          if (silentTrack) {
            silentTrack.enabled = false;
            stream.addTrack(silentTrack);
          }
        } catch {
          // ignore
        }
      }

      this.dummyStream = stream;
      return this.getOrCreateFallbackStream();
    } catch {
      return this.localStream;
    }
  }

  public connect(
    localParticipant: Omit<RoomParticipant, "stream" | "isLocal">,
    stream: MediaStream | null,
    preferHostRole = true
  ): void {
    this.isDisconnecting = false;
    this.localParticipantMeta = { ...localParticipant };
    this.localStream = stream;
    this.knownRoster.set(this.localId, this.localParticipantMeta);

    this.initBroadcastChannel();
    this.initPeerJsNetwork(preferHostRole);
  }

  private initBroadcastChannel(): void {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    this.channel = new BroadcastChannel(`freeting_room_${this.roomCode}`);
    this.channel.onmessage = async (event: MessageEvent<RoomSignalPayload>) => {
      if (this.isDisconnecting) return;
      const data = event.data;
      if (!data) return;

      await this.handleIncomingSignal(data, "broadcast");
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

      // Try claiming the Host slot first if preferHostRole is true;
      // if already taken by the room creator, automatically fall back to Guest slot!
      const initialCandidateId = preferHostRole ? hostPeerId : guestPeerId;

      const peer = new PeerClass(initialCandidateId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
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

        // If we are a Guest, connect immediately to the Host Peer ID!
        if (!this.isActingHost) {
          this.connectToRemotePeerJs(hostPeerId);
        }
      });

      peer.on("connection", (conn: DataConnection) => {
        this.setupDataConnection(conn);
      });

      peer.on("call", (call: MediaConnection) => {
        const answerStream = this.getOrCreateFallbackStream();
        if (answerStream) {
          call.answer(answerStream);
        } else {
          call.answer();
        }
        this.setupMediaConnection(call);
      });

      peer.on("error", (err: { type?: string }) => {
        // If hostPeerId is already taken, someone else is the Host of this room!
        // Reconnect immediately as a Guest participant!
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

      const streamToCall = this.getOrCreateFallbackStream();
      if (streamToCall) {
        const call = this.peerInstance.call(remotePeerJsId, streamToCall, {
          metadata: { senderId: this.localId },
        });
        if (call) {
          this.setupMediaConnection(call);
        }
      }
    } catch {
      // ignore connection error
    }
  }

  private setupDataConnection(conn: DataConnection): void {
    conn.on("open", () => {
      if (this.isDisconnecting) {
        conn.close();
        return;
      }
      this.dataConnections.set(conn.peer, conn);

      if (this.localParticipantMeta) {
        conn.send({
          type: "PEER_ANNOUNCE",
          participant: this.localParticipantMeta,
          isReply: false,
        } satisfies RoomSignalPayload);
      }

      // If we are the Host, send the full room roster to the newly connected participant
      if (this.isActingHost) {
        conn.send({
          type: "ROSTER_SYNC",
          participants: Array.from(this.knownRoster.values()),
        } satisfies RoomSignalPayload);
      }
    });

    conn.on("data", async (raw: unknown) => {
      if (this.isDisconnecting || !raw || typeof raw !== "object") return;
      const payload = raw as RoomSignalPayload;
      await this.handleIncomingSignal(payload, "peerjs", conn.peer);
    });

    conn.on("close", () => {
      this.dataConnections.delete(conn.peer);
      // Find participant with this peerJsId and notify leave
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

  private setupMediaConnection(call: MediaConnection): void {
    this.mediaConnections.set(call.peer, call);

    call.on("stream", (remoteStream: MediaStream) => {
      if (this.isDisconnecting) return;
      // Match remotePeerJsId to participantId
      let matchedParticipantId: string | null = null;
      for (const [pid, meta] of this.knownRoster.entries()) {
        if (meta.peerJsId === call.peer) {
          matchedParticipantId = pid;
          break;
        }
      }
      if (!matchedParticipantId && call.metadata?.senderId) {
        matchedParticipantId = String(call.metadata.senderId);
      }
      if (matchedParticipantId) {
        this.onRemoteStreamCallback(matchedParticipantId, remoteStream);
      } else {
        // Retry matching once PEER_ANNOUNCE arrives
        setTimeout(() => {
          for (const [pid, meta] of this.knownRoster.entries()) {
            if (meta.peerJsId === call.peer) {
              this.onRemoteStreamCallback(pid, remoteStream);
              break;
            }
          }
        }, 600);
      }
    });

    call.on("close", () => {
      this.mediaConnections.delete(call.peer);
    });
  }

  private async handleIncomingSignal(
    data: RoomSignalPayload,
    source: "broadcast" | "peerjs",
    fromPeerJsId?: string
  ): Promise<void> {
    if (data.type === "PEER_ANNOUNCE") {
      if (data.participant.id === this.localId) return;

      // If someone already in the room is HOST, ensure we don't have two hosts
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
        await this.initiateLocalRtcPeerConnection(
          data.participant.id,
          !data.isReply
        );
      } else if (source === "peerjs") {
        // If we are Host, relay the updated roster to all connected PeerJS guests
        if (this.isActingHost) {
          this.sendToAllPeerJs({
            type: "ROSTER_SYNC",
            participants: Array.from(this.knownRoster.values()),
          });
        }
        // Ensure we have an active media call if we have a real stream
        if (
          data.participant.peerJsId &&
          this.localStream &&
          this.peerInstance &&
          !this.mediaConnections.has(data.participant.peerJsId)
        ) {
          try {
            const call = this.peerInstance.call(
              data.participant.peerJsId,
              this.localStream,
              { metadata: { senderId: this.localId } }
            );
            if (call) this.setupMediaConnection(call);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    if (data.type === "ROSTER_SYNC") {
      for (const peerMeta of data.participants) {
        if (peerMeta.id !== this.localId) {
          this.knownRoster.set(peerMeta.id, peerMeta);
          this.onSignalCallback({
            type: "PEER_ANNOUNCE",
            participant: peerMeta,
            isReply: true,
          });
          // Connect directly to other guests in the mesh if not connected yet
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

    if (data.type === "PEER_STATE_UPDATE") {
      const existing = this.knownRoster.get(data.participantId);
      if (existing) {
        this.knownRoster.set(data.participantId, {
          ...existing,
          ...data.patch,
        });
      }
    } else if (data.type === "PEER_LEAVE") {
      this.knownRoster.delete(data.participantId);
    }

    // If we are the PeerJS Host and received a message from one Guest, relay it to all other Guests
    if (source === "peerjs" && this.isActingHost) {
      this.sendToAllPeerJs(data, fromPeerJsId);
    }

    this.onSignalCallback(data);
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

  public updateLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (!stream) return;

    // 1. Update local BroadcastChannel RTCPeerConnections (with SDP renegotiation if track added)
    this.localPeerConnections.forEach((pc, remotePeerId) => {
      const senders = pc.getSenders();
      let needsRenegotiation = false;
      stream.getTracks().forEach((track) => {
        const existing = senders.find((s) => s.track?.kind === track.kind);
        if (existing) {
          existing.replaceTrack(track).catch(() => {});
        } else {
          try {
            pc.addTrack(track, stream);
            needsRenegotiation = true;
          } catch {
            // ignore
          }
        }
      });
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

    // 2. Update or initiate PeerJS MediaConnections for all connected remote peers
    this.mediaConnections.forEach((call) => {
      const pc = call.peerConnection;
      if (pc) {
        const senders = pc.getSenders();
        stream.getTracks().forEach((track) => {
          const existing = senders.find((s) => s.track?.kind === track.kind);
          if (existing) {
            existing.replaceTrack(track).catch(() => {});
          } else {
            try {
              pc.addTrack(track, stream);
            } catch {
              // ignore
            }
          }
        });
      }
    });

    // Also initiate new PeerJS media call to every connected DataConnection peer so new video/audio tracks arrive reliably
    if (this.peerInstance) {
      this.dataConnections.forEach((_conn, remotePeerJsId) => {
        try {
          const call = this.peerInstance!.call(remotePeerJsId, stream, {
            metadata: { senderId: this.localId },
          });
          if (call) {
            this.setupMediaConnection(call);
          }
        } catch {
          // ignore
        }
      });
    }
  }

  private async initiateLocalRtcPeerConnection(
    remotePeerId: string,
    isInitiator: boolean
  ): Promise<RTCPeerConnection | null> {
    if (typeof window === "undefined" || !("RTCPeerConnection" in window)) {
      return null;
    }
    if (this.localPeerConnections.has(remotePeerId)) {
      return this.localPeerConnections.get(remotePeerId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.localPeerConnections.set(remotePeerId, pc);

    const activeStream = this.getOrCreateFallbackStream();
    if (activeStream) {
      activeStream.getTracks().forEach((track) => {
        pc.addTrack(track, activeStream);
      });
    }

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

    if (this.dummyStream) {
      this.dummyStream.getTracks().forEach((t) => t.stop());
      this.dummyStream = null;
    }
  }
}
