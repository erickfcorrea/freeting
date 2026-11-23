export interface RoomParticipant {
  id: string;
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

/**
 * Multi-Peer WebRTC + BroadcastChannel Signaling Engine.
 * Automatically links multiple browser tabs/windows opened on the same roomCode
 * with bidirectional discovery and live video/audio RTCPeerConnection.
 */
export class FreetingWebRtcRoomEngine {
  private roomCode: string;
  private localId: string;
  private localParticipantMeta: Omit<RoomParticipant, "stream" | "isLocal"> | null =
    null;
  private channel: BroadcastChannel | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private onSignalCallback: (payload: RoomSignalPayload) => void;
  private onRemoteStreamCallback: (peerId: string, stream: MediaStream) => void;

  constructor(options: {
    roomCode: string;
    localId: string;
    onSignal: (payload: RoomSignalPayload) => void;
    onRemoteStream: (peerId: string, stream: MediaStream) => void;
  }) {
    this.roomCode = options.roomCode;
    this.localId = options.localId;
    this.onSignalCallback = options.onSignal;
    this.onRemoteStreamCallback = options.onRemoteStream;
  }

  public connect(
    localParticipant: Omit<RoomParticipant, "stream" | "isLocal">,
    stream: MediaStream | null
  ): void {
    this.localParticipantMeta = localParticipant;
    this.localStream = stream;
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

    this.channel = new BroadcastChannel(`freeting_room_${this.roomCode}`);
    this.channel.onmessage = async (event: MessageEvent<RoomSignalPayload>) => {
      const data = event.data;
      if (!data) return;

      if (data.type === "PEER_ANNOUNCE" && data.participant.id !== this.localId) {
        this.onSignalCallback(data);
        // Reply back with our own participant profile so both tabs see each other!
        if (!data.isReply && this.localParticipantMeta) {
          this.broadcast({
            type: "PEER_ANNOUNCE",
            participant: this.localParticipantMeta,
            isReply: true,
          });
        }
        await this.initiatePeerConnection(data.participant.id, !data.isReply);
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

      this.onSignalCallback(data);
    };

    this.broadcast({
      type: "PEER_ANNOUNCE",
      participant: localParticipant,
      isReply: false,
    });
  }

  public updateLocalParticipantMeta(
    patch: Partial<Omit<RoomParticipant, "stream" | "isLocal">>
  ): void {
    if (this.localParticipantMeta) {
      this.localParticipantMeta = { ...this.localParticipantMeta, ...patch };
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
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      stream.getTracks().forEach((track) => {
        const existing = senders.find((s) => s.track?.kind === track.kind);
        if (existing) {
          existing.replaceTrack(track);
        } else {
          pc.addTrack(track, stream);
        }
      });
    });
  }

  private async initiatePeerConnection(
    remotePeerId: string,
    isInitiator: boolean
  ): Promise<RTCPeerConnection | null> {
    if (typeof window === "undefined" || !("RTCPeerConnection" in window)) {
      return null;
    }
    if (this.peerConnections.has(remotePeerId)) {
      return this.peerConnections.get(remotePeerId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.peerConnections.set(remotePeerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.broadcast({
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
        this.broadcast({
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
    const pc = await this.initiatePeerConnection(fromId, false);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(description));
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.broadcast({
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
    const pc = this.peerConnections.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ignore
    }
  }

  public broadcast(payload: RoomSignalPayload): void {
    try {
      this.channel?.postMessage(payload);
    } catch {
      // ignore closed channel
    }
  }

  public disconnect(): void {
    this.broadcast({ type: "PEER_LEAVE", participantId: this.localId });
    this.peerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    this.peerConnections.clear();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
