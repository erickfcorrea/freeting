"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Smile,
  Captions,
  Hand,
  MoreVertical,
  PhoneOff,
  MessageSquare,
  LayoutGrid,
  Lock,
  Info,
  Users,
  UserPlus,
  Copy,
  Check,
  X,
  Sparkles,
  ArrowUp,
  ChevronUp,
  Maximize2,
  Pin,
  Disc,
  Pause,
  Play,
  Square,
  Download,
  FileText,
  Edit3,
  Eye,
  Keyboard,
  Contrast,
  Share2,
  RefreshCw,
  Volume2,
  Sliders,
} from "lucide-react";
import { formatShareableLink } from "@/domain/roomCode";
import {
  UnlimitedRecordingSession,
  formatUnlimitedDuration,
  formatRecordingBytes,
  getEffectiveRecordingDurationMs,
  releaseMediaStream,
} from "@/domain/unlimitedRecorder";
import {
  LiveUnlimitedMediaRecorder,
  StoredRecordingMeta,
  listRecordingsFromVault,
  assembleRecordingBlobFromVault,
  triggerBlobDownload,
  createVirtualCameraStream,
  getRecordingFileExtension,
} from "@/services/recordingVault";
import {
  RoomParticipant,
  RoomChatMessage,
  RoomCaptionEntry,
  FloatingReaction,
  FreetingWebRtcRoomEngine,
  pickAvatarColor,
} from "@/services/webrtcRoomEngine";
import {
  AiAssistantResponse,
  generateAiMeetingResponse,
  exportMeetingMinutesMarkdown,
} from "@/services/aiMeetingAssistant";
import {
  loadLgpdConsent,
  saveLgpdConsent,
  maskPersonalDataInText,
} from "@/domain/lgpdCompliance";

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👏", "😂", "😮"];

const SIMULATED_BOT_PROFILES = [
  {
    name: "Dra. Camila Mendes",
    greeting:
      "Olá! Já estou conectada na sala, áudio e vídeo funcionando perfeitamente.",
    autoReplies: [
      "Perfeito! Estou acompanhando a apresentação.",
      "Concordo totalmente com esse ponto.",
      "Excelente! Vou registrar essa definição na nossa pauta.",
    ],
  },
  {
    name: "Carlos Eduardo",
    greeting: "Oi pessoal! Conectado e ouvindo vocês muito bem.",
    autoReplies: [
      "A conexão está ótima aqui.",
      "Boa! Tudo alinhado do meu lado.",
    ],
  },
  {
    name: "Marina Costa",
    greeting: "Olá a todos! Pronta para começarmos nossa reunião.",
    autoReplies: [
      "Sim! Depois podemos exportar o resumo da reunião.",
      "Tudo certo do meu lado, podemos seguir!",
    ],
  },
];

export type StageLayoutMode = "auto" | "grid" | "spotlight";

interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

/**
 * Always-mounted Remote Audio Renderer (decoupled from visual video tiles).
 * Prevents audio dropouts when pinning participants, switching layouts, or toggling cameras,
 * and handles iOS Safari / Android Chrome autoplay policies + VoiceChat audio session switches.
 */
function RemoteAudioTrackPlayer({
  stream,
  wakeTick,
  speakerDeviceId,
  onAutoplayBlocked,
  onAutoplayUnblocked,
}: {
  stream: MediaStream;
  wakeTick: number;
  speakerDeviceId: string;
  onAutoplayBlocked: () => void;
  onAutoplayUnblocked: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const attemptPlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !stream) return;

    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.muted = false;
    el.volume = 1.0;

    // Optional Desktop Speaker Output selection (setSinkId)
    const sinkCapable = el as HTMLAudioElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    };
    if (speakerDeviceId && typeof sinkCapable.setSinkId === "function") {
      sinkCapable.setSinkId(speakerDeviceId).catch(() => {});
    }

    const playPromise = el.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          onAutoplayUnblocked();
        })
        .catch(() => {
          onAutoplayBlocked();
        });
    }
  }, [stream, speakerDeviceId, onAutoplayBlocked, onAutoplayUnblocked]);

  useEffect(() => {
    attemptPlay();
  }, [attemptPlay, wakeTick]);

  useEffect(() => {
    if (!stream) return;

    const handleTrackChange = () => {
      attemptPlay();
    };

    stream.addEventListener("addtrack", handleTrackChange);
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.addEventListener("unmute", handleTrackChange);
    });

    const el = audioRef.current;
    const handleUnexpectedPause = () => {
      // On iOS Safari & Android, getUserMedia switches hardware audio mode and can pause <audio>
      if (
        typeof document !== "undefined" &&
        !document.hidden &&
        stream.getAudioTracks().some((t) => t.readyState === "live")
      ) {
        setTimeout(() => {
          attemptPlay();
        }, 180);
      }
    };
    el?.addEventListener("pause", handleUnexpectedPause);

    return () => {
      stream.removeEventListener("addtrack", handleTrackChange);
      audioTracks.forEach((track) => {
        track.removeEventListener("unmute", handleTrackChange);
      });
      el?.removeEventListener("pause", handleUnexpectedPause);
    };
  }, [stream, attemptPlay]);

  return <audio ref={audioRef} autoPlay playsInline controls={false} />;
}

/**
 * Pure visual Remote Video Renderer (strictly muted so mobile browsers NEVER block video autoplay;
 * audio is rendered independently by RemoteAudioTrackPlayer).
 */
function RemoteVideoSurface({
  stream,
  fitMode = "cover",
}: {
  stream?: MediaStream | null;
  fitMode?: "cover" | "contain";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.muted = true;
    el.play().catch(() => {});
  }, [stream]);

  if (!stream) return null;

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`w-full h-full ${
        fitMode === "contain" ? "object-contain bg-black" : "object-cover"
      }`}
    />
  );
}

export function MeetingRoomView({
  roomCode,
  initialIsCreator = false,
  onLeaveToHome,
}: {
  roomCode: string;
  initialIsCreator?: boolean;
  onLeaveToHome?: () => void;
}) {
  const router = useRouter();

  const [inPreJoinLobby, setInPreJoinLobby] = useState<boolean>(
    !initialIsCreator
  );
  const [displayName, setDisplayName] = useState<string>(() =>
    initialIsCreator ? "Organizador" : ""
  );
  const [isCreatorRole, setIsCreatorRole] =
    useState<boolean>(initialIsCreator);

  const [clockText, setClockText] = useState("18:32");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Media, Device & Accessibility States
  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [isVirtualCamera, setIsVirtualCamera] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<
    "user" | "environment"
  >("user");
  const [micInputLevel, setMicInputLevel] = useState<number>(0);

  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>("");
  const [selectedCamId, setSelectedCamId] = useState<string>("");
  const [openDeviceMenu, setOpenDeviceMenu] = useState<
    null | "mic" | "camera"
  >(null);

  const [audioWakeTick, setAudioWakeTick] = useState<number>(0);
  const [isAudioAutoplayBlocked, setIsAudioAutoplayBlocked] =
    useState<boolean>(false);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCaptionsOn, setIsCaptionsOn] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [lgpdAutoMask, setLgpdAutoMask] = useState<boolean>(() =>
    loadLgpdConsent().autoMaskPersonalData
  );
  const [isCallEnded, setIsCallEnded] = useState(false);
  const [highContrastMode, setHighContrastMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState<StageLayoutMode>("auto");
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(
    null
  );
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showMobileToolsSheet, setShowMobileToolsSheet] = useState(false);
  const [showMobileDeviceModal, setShowMobileDeviceModal] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [a11yLiveText, setA11yLiveText] = useState(
    `Conectado à sala ${roomCode}.`
  );

  // Overlays & Cards
  const [showReadyCard, setShowReadyCard] =
    useState<boolean>(initialIsCreator);
  const [showPtToastCard, setShowPtToastCard] =
    useState<boolean>(initialIsCreator);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showReactionBar, setShowReactionBar] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<
    null | "people" | "chat" | "activities" | "security" | "ai"
  >(null);

  // Streams & Refs
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const lobbyVideoElRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoElRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const stopVirtualCamRef = useRef<(() => void) | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const unlockAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserCtxRef = useRef<AudioContext | null>(null);
  const micMeterRafRef = useRef<number | null>(null);
  const isCaptionsOnRef = useRef<boolean>(false);
  const speechRecognitionRef = useRef<{ stop: () => void } | null>(null);
  const webrtcEngineRef = useRef<FreetingWebRtcRoomEngine | null>(null);
  const recorderRef = useRef<LiveUnlimitedMediaRecorder | null>(null);
  const localPeerIdRef = useRef<string>(
    `peer_${Math.random().toString(36).slice(2, 9)}`
  );

  // Participants, Chat, Captions, Reactions, AI
  const [participants, setParticipants] = useState<RoomParticipant[]>(() => [
    {
      id: "local_user",
      name: initialIsCreator ? "Organizador (Você)" : "Você",
      role: initialIsCreator ? "HOST" : "PARTICIPANT",
      isLocal: true,
      isMuted: true,
      isCameraOff: true,
      isScreenSharing: false,
      isHandRaised: false,
      isSpeaking: false,
      avatarColor: initialIsCreator ? "#0b57d0" : "#0f5223",
      joinedAtIso: new Date().toISOString(),
    },
  ]);

  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([
    {
      id: "welcome_msg",
      senderId: "system",
      senderName: "FREETING",
      text: "As mensagens enviadas aqui são visíveis para as pessoas na chamada.",
      timestamp: "18:32",
    },
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [captions, setCaptions] = useState<RoomCaptionEntry[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponses, setAiResponses] = useState<AiAssistantResponse[]>([]);

  const [recordingSession, setRecordingSession] =
    useState<UnlimitedRecordingSession | null>(null);
  const [recordingTickMs, setRecordingTickMs] = useState<number>(Date.now());
  const [savedRecordings, setSavedRecordings] = useState<StoredRecordingMeta[]>(
    []
  );

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setA11yLiveText(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3800);
  }, []);

  const navigateBackHome = useCallback(() => {
    if (onLeaveToHome) {
      onLeaveToHome();
    } else {
      router.push("/");
    }
  }, [onLeaveToHome, router]);

  const realShareableLink = formatShareableLink(
    roomCode,
    typeof window !== "undefined" ? window.location.origin : undefined
  );

  /**
   * Unlocks the browser's mobile/desktop audio playback pipeline and nudges all
   * <RemoteAudioTrackPlayer /> instances to call .play() immediately.
   */
  const unlockAndNudgeRemoteAudio = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) {
          if (!unlockAudioCtxRef.current) {
            unlockAudioCtxRef.current = new AudioCtx();
          }
          if (unlockAudioCtxRef.current.state === "suspended") {
            unlockAudioCtxRef.current.resume().catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    }
    setAudioWakeTick((t) => t + 1);
  }, []);

  // Automatically retry unlocking remote audio on any touch/click/key in the room
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUserInteract = () => {
      if (
        unlockAudioCtxRef.current &&
        unlockAudioCtxRef.current.state === "suspended"
      ) {
        unlockAudioCtxRef.current.resume().catch(() => {});
      }
      if (isAudioAutoplayBlocked) {
        setAudioWakeTick((t) => t + 1);
      }
    };
    const onVisibility = () => {
      if (!document.hidden) {
        setAudioWakeTick((t) => t + 1);
      }
    };
    window.addEventListener("pointerdown", onUserInteract, { passive: true });
    window.addEventListener("touchstart", onUserInteract, { passive: true });
    window.addEventListener("keydown", onUserInteract);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onUserInteract);
      window.removeEventListener("touchstart", onUserInteract);
      window.removeEventListener("keydown", onUserInteract);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAudioAutoplayBlocked]);

  // Enumerate connected microphones, speakers, and cameras (PC & Mobile)
  const refreshMediaDevices = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== "function"
    ) {
      return;
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const mics: MediaDeviceOption[] = [];
      const speakers: MediaDeviceOption[] = [];
      const cams: MediaDeviceOption[] = [];

      list.forEach((d, idx) => {
        if (d.kind === "audioinput") {
          mics.push({
            deviceId: d.deviceId,
            label: d.label || `Microfone ${mics.length + 1}`,
          });
        } else if (d.kind === "audiooutput") {
          speakers.push({
            deviceId: d.deviceId,
            label: d.label || `Alto-falante ${speakers.length + 1}`,
          });
        } else if (d.kind === "videoinput") {
          cams.push({
            deviceId: d.deviceId,
            label: d.label || `Câmera ${idx + 1}`,
          });
        }
      });

      setAudioInputs(mics);
      setAudioOutputs(speakers);
      setVideoInputs(cams);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshMediaDevices();
    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.addEventListener === "function"
    ) {
      navigator.mediaDevices.addEventListener(
        "devicechange",
        refreshMediaDevices
      );
      return () => {
        navigator.mediaDevices.removeEventListener(
          "devicechange",
          refreshMediaDevices
        );
      };
    }
  }, [refreshMediaDevices]);

  /**
   * Real-time Microphone RMS Level Analyser so PC & Mobile users visually see
   * whether their microphone is picking up voice and broadcast real speaking state.
   */
  const startMicLevelMonitor = useCallback((stream: MediaStream | null) => {
    if (micMeterRafRef.current !== null) {
      cancelAnimationFrame(micMeterRafRef.current);
      micMeterRafRef.current = null;
    }
    if (micAnalyserCtxRef.current) {
      micAnalyserCtxRef.current.close().catch(() => {});
      micAnalyserCtxRef.current = null;
    }

    const audioTrack = stream
      ?.getAudioTracks()
      .find((t) => t.readyState === "live" && t.enabled);
    if (!audioTrack || typeof window === "undefined") {
      setMicInputLevel(0);
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micAnalyserCtxRef.current = ctx;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeakingSent = false;
      let lastSentAt = 0;

      const tick = () => {
        if (!audioTrack || audioTrack.readyState !== "live" || !audioTrack.enabled) {
          setMicInputLevel(0);
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / data.length);
        const level = Math.min(100, Math.round(rms * 320));
        setMicInputLevel(level);

        const speakingNow = level > 8;
        const now = Date.now();
        if (speakingNow !== lastSpeakingSent && now - lastSentAt > 450) {
          lastSpeakingSent = speakingNow;
          lastSentAt = now;
          webrtcEngineRef.current?.updateLocalParticipantMeta({
            isSpeaking: speakingNow,
          });
          setParticipants((prev) =>
            prev.map((p) =>
              p.isLocal ? { ...p, isSpeaking: speakingNow } : p
            )
          );
        }

        micMeterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // ignore
    }
  }, []);

  /**
   * Builds the effective outbound MediaStream combining:
   * - Screen share video (if presenting) OR local camera video (if camera ON)
   * - Local microphone audio (if captured) OR screen share system audio
   */
  const getEffectiveOutboundStream = useCallback((): MediaStream | null => {
    const combined = new MediaStream();
    const screenVideo = screenStreamRef.current
      ?.getVideoTracks()
      .find((t) => t.readyState === "live");
    const camVideo = localStreamRef.current
      ?.getVideoTracks()
      .find((t) => t.readyState === "live");

    if (screenVideo) {
      combined.addTrack(screenVideo);
    } else if (camVideo) {
      combined.addTrack(camVideo);
    }

    const micAudio = localStreamRef.current
      ?.getAudioTracks()
      .find((t) => t.readyState === "live");
    const screenAudio = screenStreamRef.current
      ?.getAudioTracks()
      .find((t) => t.readyState === "live");

    if (micAudio) {
      combined.addTrack(micAudio);
    } else if (screenAudio) {
      combined.addTrack(screenAudio);
    }

    return combined.getTracks().length > 0 ? combined : null;
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockText(
        now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      );
    };
    updateClock();
    const timer = setInterval(() => {
      updateClock();
      if (!inPreJoinLobby && !isCallEnded) {
        setElapsedSeconds((prev) => prev + 1);
      }
      setRecordingTickMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [inPreJoinLobby, isCallEnded]);

  const refreshVault = useCallback(async () => {
    const list = await listRecordingsFromVault();
    setSavedRecordings(list);
  }, []);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  // Connect WebRTC + PeerJS Engine whenever inside the active call
  useEffect(() => {
    if (inPreJoinLobby || isCallEnded) return;

    unlockAndNudgeRemoteAudio();

    const localId = localPeerIdRef.current;
    const effectiveName = displayName.trim()
      ? displayName.trim()
      : isCreatorRole
      ? "Organizador"
      : `Participante ${localId.slice(-3).toUpperCase()}`;

    setParticipants((prev) => [
      ...prev
        .filter((p) => p.isLocal)
        .map((p) => ({
          ...p,
          id: localId,
          name: `${effectiveName} (Você)`,
          role: (isCreatorRole ? "HOST" : "PARTICIPANT") as
            | "HOST"
            | "PARTICIPANT",
          isMuted,
          isCameraOff,
        })),
    ]);

    const engine = new FreetingWebRtcRoomEngine({
      roomCode,
      localId,
      onRoleResolved: (resolvedRole) => {
        const isHostNow = resolvedRole === "HOST";
        setIsCreatorRole(isHostNow);
        if (!isHostNow) {
          setShowReadyCard(false);
          setShowPtToastCard(false);
        }
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, role: resolvedRole } : p))
        );
      },
      onSignal: (payload) => {
        if (payload.type === "PEER_ANNOUNCE") {
          setParticipants((prev) => {
            const exists = prev.some((p) => p.id === payload.participant.id);
            if (exists) {
              return prev.map((p) =>
                p.id === payload.participant.id
                  ? {
                      ...p,
                      ...payload.participant,
                      stream: p.stream,
                      isLocal: false,
                    }
                  : p
              );
            }
            if (!payload.isReply) {
              showToast(`${payload.participant.name} entrou na reunião`);
            }
            setShowReadyCard(false);
            setShowPtToastCard(false);
            return [
              ...prev,
              {
                ...payload.participant,
                isLocal: false,
              },
            ];
          });
        } else if (payload.type === "PEER_STATE_UPDATE") {
          setParticipants((prev) =>
            prev.map((p) =>
              p.id === payload.participantId ? { ...p, ...payload.patch } : p
            )
          );
        } else if (payload.type === "MEDIA_SYNC") {
          // Remote participant toggled mic/camera/screen -> wake up audio/video playback immediately!
          setAudioWakeTick((t) => t + 1);
        } else if (payload.type === "ROOM_LOCK_STATE") {
          setIsRoomLocked(payload.locked);
        } else if (payload.type === "PEER_LEAVE") {
          setParticipants((prev) => {
            const leaving = prev.find((p) => p.id === payload.participantId);
            if (leaving) {
              showToast(`${leaving.name} saiu da reunião`);
            }
            return prev.filter((p) => p.id !== payload.participantId);
          });
          setPinnedParticipantId((prevPin) =>
            prevPin === payload.participantId ? null : prevPin
          );
        } else if (payload.type === "CHAT_MESSAGE") {
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === payload.message.id)) return prev;
            return [...prev, payload.message];
          });
        } else if (payload.type === "REACTION") {
          spawnReaction(payload.emoji, payload.senderName);
        } else if (payload.type === "CAPTION") {
          setCaptions((prev) => {
            if (prev.some((c) => c.id === payload.entry.id)) return prev;
            return [...prev, payload.entry];
          });
        }
      },
      onRemoteStream: (peerId, stream) => {
        setParticipants((prev) => {
          const exists = prev.some((p) => p.id === peerId);
          if (!exists) {
            return [
              ...prev,
              {
                id: peerId,
                name: `Participante ${peerId.slice(-3).toUpperCase()}`,
                role: "PARTICIPANT",
                isLocal: false,
                isMuted: false,
                isCameraOff: false,
                isScreenSharing: false,
                isHandRaised: false,
                isSpeaking: false,
                avatarColor: pickAvatarColor(peerId),
                joinedAtIso: new Date().toISOString(),
                stream,
              },
            ];
          }
          return prev.map((p) => (p.id === peerId ? { ...p, stream } : p));
        });
        // If recording is active, dynamically mix this remote participant's audio into the recording!
        recorderRef.current?.attachAudioStream(stream);
        setAudioWakeTick((t) => t + 1);
      },
    });

    webrtcEngineRef.current = engine;
    engine.connect(
      {
        id: localId,
        name: effectiveName,
        role: isCreatorRole ? "HOST" : "PARTICIPANT",
        isMuted,
        isCameraOff,
        isScreenSharing,
        isHandRaised,
        isSpeaking: false,
        avatarColor: pickAvatarColor(effectiveName + localId),
        joinedAtIso: new Date().toISOString(),
      },
      getEffectiveOutboundStream(),
      isCreatorRole
    );

    return () => {
      engine.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPreJoinLobby, isCallEnded, roomCode]);

  useEffect(() => {
    return () => {
      if (micMeterRafRef.current !== null) {
        cancelAnimationFrame(micMeterRafRef.current);
      }
      if (micAnalyserCtxRef.current) {
        micAnalyserCtxRef.current.close().catch(() => {});
      }
      if (unlockAudioCtxRef.current) {
        unlockAudioCtxRef.current.close().catch(() => {});
      }
      if (stopVirtualCamRef.current) {
        stopVirtualCamRef.current();
        stopVirtualCamRef.current = null;
      }
      isCaptionsOnRef.current = false;
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      releaseMediaStream(localStreamRef.current);
      releaseMediaStream(screenStreamRef.current);
    };
  }, []);

  const bindLocalVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoElRef.current = el;
      if (el && localStreamRef.current && !isCameraOff) {
        if (el.srcObject !== localStreamRef.current) {
          el.srcObject = localStreamRef.current;
        }
        el.muted = true;
        el.play().catch(() => {});
      }
    },
    [isCameraOff]
  );

  const bindLobbyVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      lobbyVideoElRef.current = el;
      if (el && localStreamRef.current && !isCameraOff) {
        if (el.srcObject !== localStreamRef.current) {
          el.srcObject = localStreamRef.current;
        }
        el.muted = true;
        el.play().catch(() => {});
      }
    },
    [isCameraOff]
  );

  const bindScreenVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      screenVideoElRef.current = el;
      if (el && screenStreamRef.current && isScreenSharing) {
        if (el.srcObject !== screenStreamRef.current) {
          el.srcObject = screenStreamRef.current;
        }
        el.muted = true;
        el.play().catch(() => {});
      }
    },
    [isScreenSharing]
  );

  const spawnReaction = (emoji: string, senderName = "Você") => {
    const id = `react_${Date.now()}_${Math.random()}`;
    const leftPercent = 20 + Math.floor(Math.random() * 60);
    setReactions((prev) => [...prev, { id, emoji, senderName, leftPercent }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2600);
  };

  /**
   * Acquires or switches hardware microphone track cleanly without leaking previous streams,
   * applies echoCancellation + noiseSuppression + autoGainControl, and resumes remote audio on mobile.
   */
  const acquireMicrophoneTrack = useCallback(
    async (preferredDeviceId?: string): Promise<boolean> => {
      unlockAndNudgeRemoteAudio();

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        showToast(
          "Microfone indisponível sem HTTPS. Acesse via https://freeting.vercel.app."
        );
        return false;
      }

      const targetDeviceId = preferredDeviceId ?? selectedMicId;

      try {
        let audioStream: MediaStream;
        try {
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : {}),
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch {
          // Fallback to default microphone if specific deviceId constraint failed
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }

        const newTrack = audioStream.getAudioTracks()[0];
        if (!newTrack) {
          showToast("Nenhuma faixa de áudio encontrada no microfone.");
          return false;
        }
        newTrack.enabled = true;

        const usedDeviceId = newTrack.getSettings?.().deviceId;
        if (usedDeviceId) {
          setSelectedMicId(usedDeviceId);
        }

        if (!localStreamRef.current) {
          localStreamRef.current = new MediaStream();
        }
        // Stop and remove any previous audio tracks so hardware mic never conflicts
        localStreamRef.current.getAudioTracks().forEach((old) => {
          if (old !== newTrack) {
            old.stop();
            localStreamRef.current?.removeTrack(old);
          }
        });
        localStreamRef.current.addTrack(newTrack);

        recorderRef.current?.attachAudioStream(localStreamRef.current);
        webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
        startMicLevelMonitor(localStreamRef.current);
        refreshMediaDevices();

        // Critical for iOS Safari & Android: resume remote <audio> elements after VoiceChat hardware mode switch!
        unlockAndNudgeRemoteAudio();
        setTimeout(() => unlockAndNudgeRemoteAudio(), 280);

        return true;
      } catch {
        showToast(
          "Permissão negada ou nenhum microfone detectado no dispositivo."
        );
        return false;
      }
    },
    [
      selectedMicId,
      getEffectiveOutboundStream,
      startMicLevelMonitor,
      refreshMediaDevices,
      unlockAndNudgeRemoteAudio,
      showToast,
    ]
  );

  const handleToggleMic = useCallback(async () => {
    unlockAndNudgeRemoteAudio();

    if (isMuted) {
      const existingLiveTrack = localStreamRef.current
        ?.getAudioTracks()
        .find((t) => t.readyState === "live");

      if (existingLiveTrack) {
        existingLiveTrack.enabled = true;
        setIsMuted(false);
        webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
        webrtcEngineRef.current?.updateLocalParticipantMeta({
          isMuted: false,
        });
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isMuted: false } : p))
        );
        startMicLevelMonitor(localStreamRef.current);
        showToast("Microfone ativado");
        return;
      }

      const ok = await acquireMicrophoneTrack();
      if (!ok) {
        // Keep muted = true so UI never misleads user into thinking mic is live when hardware failed
        setIsMuted(true);
        return;
      }

      setIsMuted(false);
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isMuted: false,
      });
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isMuted: false } : p))
      );
      showToast("Microfone ativado");
    } else {
      localStreamRef.current
        ?.getAudioTracks()
        .forEach((t) => (t.enabled = false));
      setMicInputLevel(0);
      setIsMuted(true);
      webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isMuted: true,
        isSpeaking: false,
      });
      setParticipants((prev) =>
        prev.map((p) =>
          p.isLocal ? { ...p, isMuted: true, isSpeaking: false } : p
        )
      );
      showToast("Microfone desativado");
    }
  }, [
    isMuted,
    acquireMicrophoneTrack,
    getEffectiveOutboundStream,
    startMicLevelMonitor,
    unlockAndNudgeRemoteAudio,
    showToast,
  ]);

  /**
   * Acquires or switches camera (supporting Desktop webcam deviceId AND Mobile front/back facingMode)
   * without touching or interrupting the microphone audio track!
   */
  const acquireCameraTrack = useCallback(
    async (options?: {
      facingMode?: "user" | "environment";
      deviceId?: string;
    }): Promise<void> => {
      unlockAndNudgeRemoteAudio();

      const desiredFacing = options?.facingMode ?? cameraFacingMode;
      const desiredDeviceId = options?.deviceId ?? selectedCamId;
      const labelName = displayName.trim() || "Você";

      if (stopVirtualCamRef.current) {
        stopVirtualCamRef.current();
        stopVirtualCamRef.current = null;
      }

      // Stop old video tracks BEFORE requesting new camera (required on Android/iOS when flipping front <-> back camera!)
      localStreamRef.current?.getVideoTracks().forEach((old) => {
        old.stop();
        localStreamRef.current?.removeTrack(old);
      });

      let acquiredVideoStream: MediaStream | null = null;
      let usingVirtual = false;

      if (
        typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
      ) {
        try {
          if (desiredDeviceId && !options?.facingMode) {
            acquiredVideoStream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: desiredDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            });
          } else {
            acquiredVideoStream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: desiredFacing },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            });
          }
        } catch {
          try {
            acquiredVideoStream = await navigator.mediaDevices.getUserMedia({
              video: options?.facingMode
                ? { facingMode: desiredFacing }
                : true,
            });
          } catch {
            acquiredVideoStream = null;
          }
        }
      }

      if (!acquiredVideoStream) {
        const virtualCam = createVirtualCameraStream(labelName, roomCode);
        acquiredVideoStream = virtualCam.stream;
        stopVirtualCamRef.current = virtualCam.stopVirtualCamera;
        usingVirtual = true;
      }

      const newVideoTrack = acquiredVideoStream.getVideoTracks()[0];
      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }
      if (newVideoTrack) {
        newVideoTrack.enabled = true;
        localStreamRef.current.addTrack(newVideoTrack);
        const camSettings = newVideoTrack.getSettings?.();
        if (camSettings?.deviceId && !usingVirtual) {
          setSelectedCamId(camSettings.deviceId);
        }
      }

      setCameraFacingMode(desiredFacing);
      setIsVirtualCamera(usingVirtual);
      setIsCameraOff(false);

      webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isCameraOff: false,
      });
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isCameraOff: false } : p))
      );

      if (localVideoElRef.current) {
        localVideoElRef.current.srcObject = localStreamRef.current;
        localVideoElRef.current.muted = true;
        localVideoElRef.current.play().catch(() => {});
      }
      if (lobbyVideoElRef.current) {
        lobbyVideoElRef.current.srcObject = localStreamRef.current;
        lobbyVideoElRef.current.muted = true;
        lobbyVideoElRef.current.play().catch(() => {});
      }

      refreshMediaDevices();
      unlockAndNudgeRemoteAudio();
      setTimeout(() => unlockAndNudgeRemoteAudio(), 250);

      showToast(
        usingVirtual
          ? "Sem câmera física — Câmera Virtual Studio ativada"
          : options?.facingMode
          ? desiredFacing === "environment"
            ? "Câmera traseira ativada"
            : "Câmera frontal ativada"
          : "Câmera ativada"
      );
    },
    [
      cameraFacingMode,
      selectedCamId,
      displayName,
      roomCode,
      getEffectiveOutboundStream,
      refreshMediaDevices,
      unlockAndNudgeRemoteAudio,
      showToast,
    ]
  );

  const handleToggleCamera = useCallback(async () => {
    if (isCameraOff) {
      await acquireCameraTrack();
    } else {
      if (stopVirtualCamRef.current) {
        stopVirtualCamRef.current();
        stopVirtualCamRef.current = null;
      }
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.stop();
        localStreamRef.current?.removeTrack(t);
      });
      setIsCameraOff(true);
      setIsVirtualCamera(false);
      webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isCameraOff: true,
      });
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isCameraOff: true } : p))
      );
      showToast("Câmera desativada");
    }
  }, [isCameraOff, acquireCameraTrack, getEffectiveOutboundStream, showToast]);

  const handleFlipMobileCamera = useCallback(async () => {
    const nextFacing = cameraFacingMode === "user" ? "environment" : "user";
    await acquireCameraTrack({ facingMode: nextFacing });
  }, [cameraFacingMode, acquireCameraTrack]);

  const handleSelectMicDevice = async (deviceId: string) => {
    setSelectedMicId(deviceId);
    setOpenDeviceMenu(null);
    const ok = await acquireMicrophoneTrack(deviceId);
    if (ok) {
      setIsMuted(false);
      webrtcEngineRef.current?.updateLocalParticipantMeta({ isMuted: false });
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isMuted: false } : p))
      );
      showToast("Microfone alterado");
    }
  };

  const handleSelectSpeakerDevice = (deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    setOpenDeviceMenu(null);
    setAudioWakeTick((t) => t + 1);
    showToast("Saída de áudio alterada");
  };

  const handleSelectCameraDevice = async (deviceId: string) => {
    setSelectedCamId(deviceId);
    setOpenDeviceMenu(null);
    await acquireCameraTrack({ deviceId });
  };

  const handleToggleScreenShare = async () => {
    unlockAndNudgeRemoteAudio();

    if (!isScreenSharing) {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getDisplayMedia !== "function"
      ) {
        showToast(
          "Compartilhamento de tela disponível apenas em navegadores de computador."
        );
        return;
      }
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        screenStreamRef.current = displayStream;
        const videoTrack = displayStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            screenStreamRef.current = null;
            setIsScreenSharing(false);
            webrtcEngineRef.current?.updateLocalParticipantMeta({
              isScreenSharing: false,
              isCameraOff,
            });
            setParticipants((prev) =>
              prev.map((p) =>
                p.isLocal
                  ? { ...p, isScreenSharing: false, isCameraOff }
                  : p
              )
            );
            webrtcEngineRef.current?.updateLocalStream(
              getEffectiveOutboundStream()
            );
            showToast("Apresentação de tela encerrada");
          };
        }
        setIsScreenSharing(true);
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: true } : p))
        );
        webrtcEngineRef.current?.updateLocalParticipantMeta({
          isScreenSharing: true,
          isCameraOff: false,
        });
        // Keeps microphone audio track combined with the shared screen video track!
        webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
        if (screenVideoElRef.current) {
          screenVideoElRef.current.srcObject = displayStream;
          screenVideoElRef.current.play().catch(() => {});
        }
        showToast("Apresentando sua tela");
      } catch {
        showToast("Compartilhamento de tela cancelado");
      }
    } else {
      releaseMediaStream(screenStreamRef.current);
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      setParticipants((prev) =>
        prev.map((p) =>
          p.isLocal ? { ...p, isScreenSharing: false, isCameraOff } : p
        )
      );
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isScreenSharing: false,
        isCameraOff,
      });
      webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
      showToast("Apresentação de tela encerrada");
    }
  };

  const handleStartUnlimitedRecording = useCallback(async () => {
    try {
      const recorder = new LiveUnlimitedMediaRecorder(roomCode, (updated) => {
        setRecordingSession({ ...updated });
      });
      recorderRef.current = recorder;

      const remotePresenter = participants.find(
        (p) => !p.isLocal && p.isScreenSharing && p.stream
      );
      const primaryStream = isScreenSharing
        ? screenStreamRef.current
        : remotePresenter?.stream || localStreamRef.current;

      await recorder.start({
        primaryVideoStream: primaryStream,
        audioStreams: [
          localStreamRef.current,
          screenStreamRef.current,
          ...participants.map((p) => p.stream),
        ],
        roomCode,
        participantNames: participants.map((p) => p.name),
        getActiveCaption: () =>
          captions.length > 0
            ? `${captions[captions.length - 1].speakerName}: ${
                captions[captions.length - 1].text
              }`
            : "",
      });
      saveLgpdConsent({ recordingConsentGranted: true });
      const lgpdNotice: RoomChatMessage = {
        id: `lgpd_rec_${Date.now()}`,
        senderId: "system",
        senderName: "Aviso de Privacidade (LGPD)",
        text: "A gravação desta reunião foi iniciada com transparência aos participantes (Art. 7º, I da LGPD).",
        timestamp: clockText,
      };
      setChatMessages((prev) => [...prev, lgpdNotice]);
      webrtcEngineRef.current?.broadcast({
        type: "CHAT_MESSAGE",
        message: lgpdNotice,
      });
      showToast("● Gravação iniciada");
    } catch {
      showToast("Erro ao iniciar gravação neste navegador.");
    }
  }, [roomCode, isScreenSharing, participants, captions, clockText, showToast]);

  const handlePauseResumeRecording = () => {
    if (!recorderRef.current || !recordingSession) return;
    if (recordingSession.state === "RECORDING") {
      recorderRef.current.pause();
      showToast("Gravação pausada");
    } else if (recordingSession.state === "PAUSED") {
      recorderRef.current.resume();
      showToast("Gravação retomada");
    }
  };

  const handleStopAndDownloadRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    const { blob } = await recorderRef.current.stopAndSave({
      title: `Reunião FREETING (${roomCode})`,
      transcriptSummary: captions
        .map((c) => `${c.speakerName}: ${c.text}`)
        .join(" | "),
      autoDownload: true,
    });
    recorderRef.current = null;
    setRecordingSession(null);
    await refreshVault();
    if (blob.size > 0) {
      const url = URL.createObjectURL(blob);
      setPreviewVideoUrl(url);
    }
    setActiveDrawer("activities");
    showToast("✓ Gravação concluída e salva!");
  }, [roomCode, captions, showToast, refreshVault]);

  const handleToggleCaptions = useCallback(() => {
    const next = !isCaptionsOn;
    setIsCaptionsOn(next);
    isCaptionsOnRef.current = next;

    if (next) {
      const localSpeaker = displayName.trim() || "Você";
      const entry: RoomCaptionEntry = {
        id: `cap_${Date.now()}`,
        speakerName: localSpeaker,
        text: "Legendas ao vivo em Português ativadas.",
        timestamp: clockText,
      };
      setCaptions((prev) => [...prev, entry]);
      webrtcEngineRef.current?.broadcast({ type: "CAPTION", entry });

      if (typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SpeechRec =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).SpeechRecognition ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          try {
            const recognition = new SpeechRec();
            recognition.lang = "pt-BR";
            recognition.continuous = true;
            recognition.interimResults = false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recognition.onresult = (event: any) => {
              const lastResult = event.results[event.results.length - 1];
              if (lastResult && lastResult[0]?.transcript) {
                const rawSpoken = String(lastResult[0].transcript).trim();
                const spokenText = maskPersonalDataInText(
                  rawSpoken,
                  lgpdAutoMask
                );
                if (spokenText) {
                  const capEntry: RoomCaptionEntry = {
                    id: `cap_${Date.now()}`,
                    speakerName: localSpeaker,
                    text: spokenText,
                    timestamp: new Date().toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  };
                  setCaptions((prev) => [...prev, capEntry]);
                  webrtcEngineRef.current?.broadcast({
                    type: "CAPTION",
                    entry: capEntry,
                  });
                }
              }
            };
            // Auto-restart SpeechRecognition on Android/Desktop Chrome when silence ends session
            recognition.onend = () => {
              if (isCaptionsOnRef.current) {
                try {
                  recognition.start();
                } catch {
                  // ignore
                }
              }
            };
            recognition.start();
            speechRecognitionRef.current = recognition;
            showToast("Legendas em Português (CC) ativadas");
          } catch {
            showToast("Legendas ativadas (exibindo falas recebidas na sala)");
          }
        } else {
          showToast(
            "Legendas ativadas (recebendo transcrições dos participantes)"
          );
        }
      }
    } else {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {
          // ignore
        }
        speechRecognitionRef.current = null;
      }
      showToast("Legendas ao vivo desativadas");
    }
  }, [isCaptionsOn, displayName, clockText, lgpdAutoMask, showToast]);

  const handleToggleHandRaise = useCallback(() => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    showToast(next ? "✋ Mão levantada" : "Mão abaixada");
    webrtcEngineRef.current?.updateLocalParticipantMeta({
      isHandRaised: next,
    });
    setParticipants((prev) =>
      prev.map((p) => (p.isLocal ? { ...p, isHandRaised: next } : p))
    );
  }, [isHandRaised, showToast]);

  useEffect(() => {
    if (inPreJoinLobby) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        handleToggleMic();
      } else if (e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handleToggleCamera();
      } else if (e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (!recordingSession) handleStartUnlimitedRecording();
        else handleStopAndDownloadRecording();
      } else if (e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleToggleCaptions();
      } else if (e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        handleToggleHandRaise();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowShortcutsModal((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    inPreJoinLobby,
    handleToggleMic,
    handleToggleCamera,
    handleStartUnlimitedRecording,
    handleStopAndDownloadRecording,
    handleToggleCaptions,
    handleToggleHandRaise,
    recordingSession,
  ]);

  const handleSendAiPrompt = (e?: React.FormEvent, customPrompt?: string) => {
    e?.preventDefault();
    const query = (customPrompt ?? aiPrompt).trim();
    if (!query) return;

    const resp = generateAiMeetingResponse({
      prompt: query,
      roomCode,
      elapsedFormatted: formatUnlimitedDuration(elapsedSeconds),
      participants: participants.map((p) => p.name),
      captions,
      chatMessages,
    });
    setAiResponses((prev) => [resp, ...prev]);
    setAiPrompt("");
    setActiveDrawer("ai");
    showToast("Resumo da IA gerado com sucesso");
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    const userText = maskPersonalDataInText(chatDraft.trim(), lgpdAutoMask);
    const localSenderName =
      displayName.trim() || (isCreatorRole ? "Organizador" : "Participante");

    const msg: RoomChatMessage = {
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: localPeerIdRef.current,
      senderName: localSenderName,
      text: userText,
      timestamp: clockText,
    };
    setChatMessages((prev) => [...prev, msg]);
    webrtcEngineRef.current?.broadcast({ type: "CHAT_MESSAGE", message: msg });
    setChatDraft("");

    if (isCaptionsOn) {
      const capEntry: RoomCaptionEntry = {
        id: `cap_chat_${Date.now()}`,
        speakerName: localSenderName,
        text: userText,
        timestamp: clockText,
      };
      setCaptions((prev) => [...prev, capEntry]);
      webrtcEngineRef.current?.broadcast({ type: "CAPTION", entry: capEntry });
    }

    const bots = participants.filter((p) => p.isSimulated);
    if (bots.length > 0) {
      const responder = bots[bots.length - 1];
      const profile =
        SIMULATED_BOT_PROFILES.find((b) => b.name === responder.name) ||
        SIMULATED_BOT_PROFILES[0];
      const replyText =
        profile.autoReplies[
          Math.floor(Math.random() * profile.autoReplies.length)
        ];
      setTimeout(() => {
        const replyMsg: RoomChatMessage = {
          id: `chat_bot_${Date.now()}`,
          senderId: responder.id,
          senderName: responder.name,
          text: replyText,
          timestamp: new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setChatMessages((prev) => [...prev, replyMsg]);
      }, 1200);
    }
  };

  const handleExportMarkdownMinutes = () => {
    const md = exportMeetingMinutesMarkdown({
      roomCode,
      elapsedFormatted: formatUnlimitedDuration(elapsedSeconds),
      participants: participants.map((p) => p.name),
      captions,
      chatMessages,
      aiNotes: aiResponses,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, `ata-freeting-${roomCode}.md`);
    showToast("Resumo da reunião exportado");
  };

  const handleEndCall = async () => {
    if (recorderRef.current && recordingSession) {
      await handleStopAndDownloadRecording();
    }
    if (micMeterRafRef.current !== null) {
      cancelAnimationFrame(micMeterRafRef.current);
      micMeterRafRef.current = null;
    }
    if (stopVirtualCamRef.current) {
      stopVirtualCamRef.current();
      stopVirtualCamRef.current = null;
    }
    isCaptionsOnRef.current = false;
    setIsCaptionsOn(false);
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    releaseMediaStream(localStreamRef.current);
    localStreamRef.current = null;
    releaseMediaStream(screenStreamRef.current);
    screenStreamRef.current = null;
    setIsMuted(true);
    setIsCameraOff(true);
    setIsScreenSharing(false);
    webrtcEngineRef.current?.disconnect();
    setIsCallEnded(true);
  };

  const handleCopyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(realShareableLink);
      setCopiedLink(true);
      showToast("Link da reunião copiado!");
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleNativeShareRoomLink = async () => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title: "Convite de Reunião FREETING",
          text: `Entre na nossa sala de reunião (${roomCode}):`,
          url: realShareableLink,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopyRoomLink();
  };

  const activeRecDurationSec = recordingSession
    ? Math.floor(
        getEffectiveRecordingDurationMs(recordingSession, recordingTickMs) /
          1000
      )
    : 0;

  const remoteScreenSharer = participants.find(
    (p) => !p.isLocal && p.isScreenSharing && p.stream
  );
  const anyPresentationActive = isScreenSharing || !!remoteScreenSharer;

  const pinnedParticipant = pinnedParticipantId
    ? participants.find((p) => p.id === pinnedParticipantId) || null
    : null;

  const visibleGridParticipants =
    layoutMode === "spotlight" && pinnedParticipant
      ? [pinnedParticipant]
      : participants;

  const shouldMirrorLocalVideo =
    cameraFacingMode === "user" && !isVirtualCamera;

  // ============================================================================
  // SCREEN 1: PRE-JOIN GREEN ROOM LOBBY ("Pronto para participar?") — Mobile-First
  // ============================================================================
  if (inPreJoinLobby) {
    return (
      <div className="min-h-[100dvh] safe-top safe-bottom bg-white text-[#1f1f1f] flex flex-col">
        {statusToast && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] bg-[#202124] text-white px-4 py-2 rounded-full text-xs font-medium shadow-xl">
            {statusToast}
          </div>
        )}

        <header className="h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between border-b border-[#dadce0]/60 shrink-0">
          <button
            type="button"
            onClick={navigateBackHome}
            className="text-lg sm:text-xl font-bold tracking-wider text-[#B8860B] cursor-pointer"
          >
            FREETING
          </button>
          <span className="text-xs text-[#5f6368] font-mono bg-[#f1f3f4] px-3 py-1 rounded-full">
            {roomCode}
          </span>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-10 grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center">
          {/* Camera & Mic Preview Box — 4:3 on Mobile so CTA stays visible without scrolling */}
          <div className="lg:col-span-7 bg-[#202124] rounded-3xl aspect-[4/3] sm:aspect-video relative overflow-hidden flex items-center justify-center shadow-xl">
            {!isCameraOff ? (
              <video
                ref={bindLobbyVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  shouldMirrorLocalVideo ? "-scale-x-100" : ""
                }`}
              />
            ) : (
              <div className="text-center space-y-2.5 px-4">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#0b57d0] text-white text-2xl font-semibold flex items-center justify-center mx-auto shadow-md">
                  {(displayName.trim() || "P").charAt(0).toUpperCase()}
                </div>
                <p className="text-xs sm:text-sm text-[#e3e3e3]">
                  A câmera está desligada
                </p>
              </div>
            )}

            {/* Live Mic Level Pill in Lobby */}
            {!isMuted && (
              <div className="absolute top-3.5 left-3.5 bg-black/60 backdrop-blur-xs rounded-full px-3 py-1.5 flex items-center gap-2 text-[11px] text-white">
                <Mic className="w-3.5 h-3.5 text-[#81c995]" />
                <div className="w-14 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${Math.max(10, micInputLevel)}%` }}
                    className="h-full bg-[#81c995] transition-all duration-75"
                  />
                </div>
              </div>
            )}

            {/* Flip Camera Button in Lobby when Camera is ON */}
            {!isCameraOff && !isVirtualCamera && (
              <button
                type="button"
                onClick={handleFlipMobileCamera}
                title="Inverter câmera (Frontal / Traseira)"
                aria-label="Inverter câmera"
                className="absolute top-3.5 right-3.5 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleToggleMic}
                aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer shadow-lg ${
                  isMuted
                    ? "bg-[#ea4335] text-white active:bg-[#d93025]"
                    : "bg-[#0b57d0] text-white active:bg-[#0842a0]"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleToggleCamera}
                aria-label={isCameraOff ? "Ativar câmera" : "Desativar câmera"}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer shadow-lg ${
                  isCameraOff
                    ? "bg-[#ea4335] text-white active:bg-[#d93025]"
                    : "bg-[#0b57d0] text-white active:bg-[#0842a0]"
                }`}
              >
                {isCameraOff ? (
                  <VideoOff className="w-5 h-5" />
                ) : (
                  <Video className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Join Form — Unlocks Mobile Audio Pipeline synchronously on Submit */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              unlockAndNudgeRemoteAudio();
              setInPreJoinLobby(false);
            }}
            className="lg:col-span-5 flex flex-col items-center lg:items-start text-center lg:text-left space-y-4 sm:space-y-5 w-full"
          >
            <div>
              <h1 className="text-xl sm:text-3xl font-normal text-[#1f1f1f]">
                Pronto para participar?
              </h1>
              <p className="text-xs sm:text-sm text-[#5f6368] mt-1">
                Sala{" "}
                <code className="font-mono font-semibold text-[#1f1f1f]">
                  {roomCode}
                </code>
              </p>
            </div>

            <div className="w-full max-w-sm">
              <label className="block text-xs font-medium text-[#5f6368] mb-1.5 text-left">
                Qual é o seu nome?
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Digite seu nome para entrar"
                className="w-full border border-[#dadce0] focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 rounded-2xl px-4 py-3 text-base text-[#1f1f1f] focus:outline-none"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full max-w-sm pt-1">
              <button
                type="submit"
                className="h-12 px-8 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] active:scale-[0.99] text-white text-sm font-semibold shadow-md transition-all cursor-pointer flex-1"
              >
                Participar agora
              </button>
              <button
                type="button"
                onClick={navigateBackHome}
                className="h-12 px-5 rounded-full border border-[#dadce0] hover:bg-[#f1f3f4] text-sm font-medium text-[#5f6368] transition-colors cursor-pointer"
              >
                Voltar
              </button>
            </div>
          </form>
        </main>
      </div>
    );
  }

  // ============================================================================
  // SCREEN 2: POST-CALL SUMMARY ("Você saiu da reunião")
  // ============================================================================
  if (isCallEnded) {
    return (
      <div className="min-h-[100dvh] safe-top safe-bottom bg-[#131314] text-white flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="max-w-lg w-full bg-[#1e1f20] border border-[#3c4043] rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <h1 className="text-xl sm:text-2xl font-normal">
            Você saiu da reunião
          </h1>
          <p className="text-sm text-[#c4c7c5]">
            Sala <code className="text-white font-mono">{roomCode}</code> •
            Duração:{" "}
            <strong className="text-white">
              {formatUnlimitedDuration(elapsedSeconds)}
            </strong>
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => {
                setIsCallEnded(false);
                setInPreJoinLobby(true);
              }}
              className="h-11 px-5 rounded-full border border-[#8e918f] hover:bg-[#282a2c] text-sm font-medium cursor-pointer"
            >
              Voltar para a sala
            </button>
            <button
              type="button"
              onClick={handleExportMarkdownMinutes}
              className="h-11 px-5 rounded-full bg-[#004a77] hover:bg-[#00639b] text-[#c2e7ff] text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              Baixar resumo
            </button>
            <button
              type="button"
              onClick={navigateBackHome}
              className="h-11 px-6 rounded-full bg-[#a8c7fa] hover:bg-[#8ab4f8] text-[#041e49] text-sm font-semibold cursor-pointer"
            >
              Tela inicial
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // SCREEN 3: ACTIVE MEETING ROOM — 100dvh Mobile-First & Full Desktop
  // ============================================================================
  return (
    <div
      className={`h-[100dvh] max-h-[100dvh] w-full safe-top safe-bottom flex flex-col justify-between overflow-hidden select-none ${
        highContrastMode ? "bg-black text-white" : "bg-[#131314] text-white"
      }`}
    >
      {/* ALWAYS-MOUNTED DEDICATED REMOTE AUDIO LAYER (Never unmounts on layout/pin/camera changes!) */}
      <div className="sr-only" aria-hidden="true">
        {participants
          .filter((p) => !p.isLocal && !!p.stream)
          .map((p) => (
            <RemoteAudioTrackPlayer
              key={p.id}
              stream={p.stream!}
              wakeTick={audioWakeTick}
              speakerDeviceId={selectedSpeakerId}
              onAutoplayBlocked={() => setIsAudioAutoplayBlocked(true)}
              onAutoplayUnblocked={() => setIsAudioAutoplayBlocked(false)}
            />
          ))}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {a11yLiveText}
      </div>

      {/* MOBILE AUTOPLAY RECOVERY BANNER — 1-Tap Unblock if iOS Safari / Android Chrome Paused Call Audio */}
      {isAudioAutoplayBlocked && (
        <button
          type="button"
          onClick={() => {
            unlockAndNudgeRemoteAudio();
            setIsAudioAutoplayBlocked(false);
          }}
          className="fixed top-15 left-1/2 -translate-x-1/2 z-50 bg-[#0b57d0] hover:bg-[#0842a0] text-white px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold shadow-2xl flex items-center gap-2 border border-white/25 animate-bounce cursor-pointer"
        >
          <Volume2 className="w-4 h-4 shrink-0" />
          <span>Toque aqui para ativar o áudio da chamada</span>
        </button>
      )}

      {statusToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] bg-[#282a2c] border border-[#8ab4f8]/50 text-white px-4 py-2 rounded-full text-xs font-medium shadow-2xl flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#81c995] shrink-0" />
          <span className="truncate">{statusToast}</span>
        </div>
      )}

      {/* TOP BAR — Compact & Touch-Friendly on Mobile */}
      <header className="h-13 sm:h-14 px-3 sm:px-5 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden sm:inline text-sm font-medium text-[#e3e3e3]">
            {clockText}
          </span>
          <span className="hidden sm:inline text-[#5f6368]">|</span>
          <span className="text-xs sm:text-sm font-semibold sm:font-medium text-[#e3e3e3] tracking-wide truncate">
            {roomCode}
          </span>
          {isRoomLocked && (
            <span
              title="Sala bloqueada pelo organizador"
              className="bg-[#3c4043] text-[#fbbc04] px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 shrink-0"
            >
              <Lock className="w-3 h-3" />
              <span className="hidden sm:inline">Bloqueada</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowReadyCard((v) => !v)}
            title="Detalhes e link da reunião"
            aria-label="Detalhes da sala"
            className="w-9 h-9 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Info className="w-4 h-4" />
          </button>

          {/* Mobile 1-Tap Native Share Button (WhatsApp / Telegram / Copy) */}
          <button
            type="button"
            onClick={handleNativeShareRoomLink}
            title="Compartilhar link da sala"
            aria-label="Compartilhar link da sala"
            className="md:hidden w-9 h-9 rounded-full bg-[#282a2c] active:bg-[#3c4043] text-[#a8c7fa] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {/* Active Recording Pill */}
          {recordingSession && (
            <div className="flex items-center gap-1.5 bg-[#3c1917] border border-[#f28b82]/50 text-[#f28b82] rounded-full px-2.5 sm:px-3.5 py-1 text-[11px] sm:text-xs font-medium animate-pulse shrink-0">
              <span className="w-2 h-2 rounded-full bg-[#ea4335]" />
              <span>
                {formatUnlimitedDuration(activeRecDurationSec, false)}
              </span>
              <button
                type="button"
                onClick={handlePauseResumeRecording}
                className="p-0.5 hover:text-white cursor-pointer"
              >
                {recordingSession.state === "PAUSED" ? (
                  <Play className="w-3.5 h-3.5" />
                ) : (
                  <Pause className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleStopAndDownloadRecording}
                className="p-0.5 hover:text-white cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            </div>
          )}
        </div>

        {/* Right Top Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mobile Camera Flip Quick Button when Camera is Active */}
          {!isCameraOff && !isVirtualCamera && (
            <button
              type="button"
              onClick={handleFlipMobileCamera}
              title="Inverter câmera (Frontal / Traseira)"
              aria-label="Inverter câmera"
              className="md:hidden w-9 h-9 rounded-full bg-[#282a2c] active:bg-[#3c4043] flex items-center justify-center text-[#e3e3e3] cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setHighContrastMode((v) => !v);
              showToast(
                !highContrastMode
                  ? "Alto contraste ativado"
                  : "Alto contraste desativado"
              );
            }}
            title="Alto Contraste"
            aria-label="Alternar Alto Contraste"
            className={`hidden sm:flex w-8 h-8 rounded-full items-center justify-center cursor-pointer ${
              highContrastMode
                ? "bg-yellow-400 text-black"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#c4c7c5]"
            }`}
          >
            <Contrast className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowShortcutsModal(true)}
            title="Atalhos de Teclado (?)"
            aria-label="Abrir guia de atalhos de teclado"
            className="hidden md:flex w-8 h-8 rounded-full bg-[#282a2c] hover:bg-[#3c4043] items-center justify-center text-[#c4c7c5] cursor-pointer"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* Mobile Quick Chat Button in Header */}
          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "chat" ? null : "chat"))
            }
            aria-label="Abrir chat"
            className="md:hidden w-9 h-9 rounded-full bg-[#282a2c] active:bg-[#3c4043] flex items-center justify-center text-[#e3e3e3] relative cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            {chatMessages.length > 1 && (
              <span className="w-2 h-2 rounded-full bg-[#a8c7fa] absolute top-1.5 right-1.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "people" ? null : "people"))
            }
            aria-label={`Participantes na sala: ${participants.length}`}
            className="flex items-center gap-1.5 bg-[#282a2c] hover:bg-[#3c4043] rounded-full px-3 h-9 cursor-pointer"
          >
            <Users className="w-4 h-4 text-[#a8c7fa]" />
            <span className="text-xs font-semibold text-[#e3e3e3]">
              {participants.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "activities" ? null : "activities"))
            }
            title="Gravações e atividades"
            aria-label="Gravações e atividades"
            className="hidden sm:flex w-9 h-9 rounded-full bg-[#282a2c] hover:bg-[#3c4043] items-center justify-center text-[#c4c7c5] cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN VIDEO STAGE + PRESENTATION STAGE + FLOATING CARDS + ADAPTIVE DRAWER */}
      <div
        className={`flex-1 px-2.5 sm:px-4 py-1 flex ${
          anyPresentationActive ? "flex-col lg:flex-row" : "flex-row"
        } gap-2.5 sm:gap-3 overflow-hidden relative min-h-0`}
      >
        {/* Local OR Remote Screen Share Presentation Stage (Uncropped object-contain on Mobile & PC!) */}
        {anyPresentationActive && (
          <div className="flex-1 bg-[#0d1520] border-2 border-[#a8c7fa]/40 rounded-2xl relative flex flex-col overflow-hidden min-h-0">
            <div className="bg-[#1e1f20]/90 px-3 sm:px-4 py-2 flex items-center justify-between border-b border-[#3c4043]">
              <span className="text-xs font-medium text-[#a8c7fa] flex items-center gap-2 truncate">
                <MonitorUp className="w-4 h-4 shrink-0" />
                {isScreenSharing
                  ? "Apresentando sua tela"
                  : `Apresentação de ${remoteScreenSharer?.name}`}
              </span>
              {isScreenSharing ? (
                <button
                  type="button"
                  onClick={handleToggleScreenShare}
                  className="px-3 py-1 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white text-xs font-semibold shrink-0 cursor-pointer"
                >
                  Parar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      typeof document !== "undefined" &&
                      document.documentElement.requestFullscreen
                    ) {
                      if (!document.fullscreenElement) {
                        document.documentElement
                          .requestFullscreen()
                          .catch(() => {});
                      } else {
                        document.exitFullscreen?.().catch(() => {});
                      }
                    }
                  }}
                  className="px-2.5 py-1 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-white text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tela cheia</span>
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
              {isScreenSharing ? (
                <video
                  ref={bindScreenVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain bg-black"
                />
              ) : (
                <RemoteVideoSurface
                  stream={remoteScreenSharer?.stream}
                  fitMode="contain"
                />
              )}
            </div>
          </div>
        )}

        {/* Portrait-Aware Mobile & Desktop Video Stage Grid */}
        <div
          className={`${
            anyPresentationActive
              ? "h-28 lg:h-full lg:w-72 shrink-0 flex flex-row lg:flex-col overflow-x-auto no-scrollbar"
              : "flex-1 grid min-h-0"
          } gap-2.5 sm:gap-3 h-full ${
            !anyPresentationActive &&
            (visibleGridParticipants.length === 1
              ? "grid-cols-1 grid-rows-1"
              : visibleGridParticipants.length === 2
              ? "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1"
              : visibleGridParticipants.length <= 4
              ? "grid-cols-2 grid-rows-2"
              : "grid-cols-2 lg:grid-cols-3")
          }`}
        >
          {visibleGridParticipants.map((participant) => {
            const showRemoteCameraVideo =
              !participant.isLocal &&
              !participant.isCameraOff &&
              !!participant.stream &&
              participant.stream
                .getVideoTracks()
                .some((t) => t.readyState === "live");

            const isThisPinned =
              layoutMode === "spotlight" &&
              pinnedParticipantId === participant.id;

            return (
              <div
                key={participant.id}
                className={`rounded-2xl relative flex items-center justify-center overflow-hidden shadow-inner group ${
                  anyPresentationActive
                    ? "w-40 lg:w-full h-full shrink-0"
                    : "w-full h-full min-h-0"
                } ${
                  highContrastMode
                    ? "bg-[#0a192f] border-2 border-yellow-400"
                    : participant.isSpeaking && !participant.isMuted
                    ? "bg-[#1b3a6b] border-2 border-[#81c995]"
                    : "bg-[#1b3a6b] border border-white/10"
                }`}
              >
                {/* Top-Right Mic Status / Equalizer + Flip Camera on Local Tile */}
                <div className="absolute top-2.5 right-2.5 sm:top-3.5 sm:right-3.5 z-10 flex items-center gap-1.5">
                  {participant.isLocal && !isCameraOff && !isVirtualCamera && (
                    <button
                      type="button"
                      onClick={handleFlipMobileCamera}
                      title="Inverter câmera"
                      aria-label="Inverter câmera"
                      className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center ${
                      participant.isMuted
                        ? "bg-[#172b4d]/85 text-[#8ab4f8]"
                        : "bg-[#137333]/90 text-white"
                    }`}
                  >
                    {participant.isMuted ? (
                      <MicOff className="w-3.5 h-3.5" />
                    ) : (
                      <div className="flex items-end gap-0.5 h-3">
                        <span className="w-0.5 h-full bg-white rounded-full animate-eq-1" />
                        <span className="w-0.5 h-full bg-white rounded-full animate-eq-2" />
                        <span className="w-0.5 h-full bg-white rounded-full animate-eq-3" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Raised Hand Badge */}
                {participant.isHandRaised && (
                  <div className="absolute top-2.5 left-2.5 sm:top-3.5 sm:left-3.5 z-10 bg-[#fbbc04] text-[#1f1f1f] px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 shadow-md">
                    <Hand className="w-3 h-3" />
                    <span>Mão levantada</span>
                  </div>
                )}

                {/* Visual Video Surface (Remote or Local) or Avatar */}
                {participant.isLocal && !isCameraOff ? (
                  <video
                    ref={bindLocalVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${
                      shouldMirrorLocalVideo ? "-scale-x-100" : ""
                    }`}
                  />
                ) : showRemoteCameraVideo ? (
                  <RemoteVideoSurface
                    stream={participant.stream}
                    fitMode={participant.isScreenSharing ? "contain" : "cover"}
                  />
                ) : (
                  <div className="relative flex items-center justify-center">
                    <div
                      style={{ backgroundColor: participant.avatarColor }}
                      className={`w-18 h-18 sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-semibold text-white shadow-lg transition-transform ${
                        !participant.isMuted
                          ? "ring-4 ring-[#8ab4f8]/70 scale-105"
                          : ""
                      }`}
                    >
                      {participant.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}

                {/* Hover / Tap Pin & Fullscreen Pill */}
                <div className="hidden sm:flex absolute inset-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="pointer-events-auto bg-[#202124]/85 backdrop-blur-xs text-[#e3e3e3] rounded-full px-3 py-1.5 flex items-center gap-3 shadow-md">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          typeof document !== "undefined" &&
                          document.documentElement.requestFullscreen
                        ) {
                          if (!document.fullscreenElement) {
                            document.documentElement
                              .requestFullscreen()
                              .catch(() => {});
                          } else {
                            document.exitFullscreen?.().catch(() => {});
                          }
                        }
                      }}
                      title="Tela cheia"
                      className="hover:text-white cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isThisPinned) {
                          setLayoutMode("auto");
                          setPinnedParticipantId(null);
                        } else {
                          setPinnedParticipantId(participant.id);
                          setLayoutMode("spotlight");
                        }
                      }}
                      title={
                        isThisPinned ? "Desafixar destaque" : "Fixar em destaque"
                      }
                      className={`hover:text-white cursor-pointer ${
                        isThisPinned ? "text-[#a8c7fa]" : ""
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Bottom-left Participant Nameplate */}
                <div className="absolute bottom-2.5 left-2.5 sm:bottom-3 sm:left-3.5 max-w-[85%] bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-medium text-white flex items-center gap-1.5 truncate">
                  <span className="truncate">{participant.name}</span>
                  <span className="hidden sm:inline text-[10px] text-[#a8c7fa] shrink-0">
                    •{" "}
                    {participant.role === "HOST"
                      ? "Organizador"
                      : "Participante"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* FLOATING OVERLAY: "Sua reunião está pronta" */}
        {showReadyCard && (
          <div className="absolute bottom-2 left-2.5 right-2.5 sm:bottom-3 sm:left-6 sm:right-auto z-30 sm:w-[330px] flex flex-col">
            <div className="bg-white text-[#1f1f1f] rounded-2xl p-4 sm:p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm sm:text-base font-semibold text-[#1f1f1f]">
                  Sua reunião está pronta
                </h2>
                <button
                  type="button"
                  onClick={() => setShowReadyCard(false)}
                  aria-label="Fechar cartão de convite"
                  className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleNativeShareRoomLink}
                className="w-full sm:w-auto bg-[#0b57d0] hover:bg-[#0842a0] text-white rounded-full px-4 py-2.5 text-xs font-semibold inline-flex items-center justify-center gap-2 mb-3 cursor-pointer shadow-xs"
              >
                <UserPlus className="w-4 h-4" />
                <span>Convidar e compartilhar link</span>
              </button>

              <p className="text-xs text-[#444746] leading-relaxed mb-2">
                Ou copie o link da sala para enviar a quem vai participar:
              </p>

              <div className="bg-[#f1f3f4] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                <span className="text-xs text-[#1f1f1f] truncate font-mono">
                  {realShareableLink}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRoomLink}
                  title="Copiar link da reunião"
                  aria-label="Copiar link da reunião"
                  className="text-[#444746] hover:text-[#1f1f1f] p-1 cursor-pointer shrink-0"
                >
                  {copiedLink ? (
                    <Check className="w-4 h-4 text-[#137333]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {showPtToastCard && (
              <div className="hidden sm:block bg-[#004a77] text-white rounded-2xl p-4 shadow-2xl -mt-3 mx-1 relative border border-[#00639b]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="bg-[#c2e7ff] text-[#001d35] text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Novo
                    </span>
                    <span className="text-xs font-semibold">
                      Já disponível em Português
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPtToastCard(false)}
                    aria-label="Fechar aviso"
                    className="text-[#c2e7ff] hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-[#e1f5fe] leading-relaxed">
                  Agora você pode fazer perguntas ao assistente e receber
                  resumos de discussões em Português.
                </p>
                <div className="w-3 h-3 bg-[#004a77] rotate-45 absolute -bottom-1.5 left-10 border-r border-b border-[#00639b]" />
              </div>
            )}
          </div>
        )}

        {/* FLOATING EMOJI REACTIONS */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
          {reactions.map((r) => (
            <div
              key={r.id}
              style={{ left: `${r.leftPercent}%` }}
              className="absolute bottom-14 flex flex-col items-center animate-reaction-float"
            >
              <span className="text-4xl drop-shadow-md">{r.emoji}</span>
              <span className="text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full mt-1">
                {r.senderName}
              </span>
            </div>
          ))}
        </div>

        {/* LIVE CAPTIONS OVERLAY (CC) */}
        {isCaptionsOn && captions.length > 0 && (
          <div className="absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-2xl w-full px-3 sm:px-4 pointer-events-none">
            <div className="bg-black/85 backdrop-blur-xs border border-white/15 rounded-2xl px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm text-white shadow-xl">
              <div className="text-[10px] sm:text-[11px] text-[#8ab4f8] font-semibold mb-0.5">
                {captions[captions.length - 1].speakerName} • Legendas ao Vivo
              </div>
              <div>{captions[captions.length - 1].text}</div>
            </div>
          </div>
        )}

        {/* ADAPTIVE DRAWER: Bottom Sheet on Mobile (< lg), Side Panel on Desktop (lg:) */}
        {activeDrawer && (
          <>
            <div
              className="lg:hidden fixed inset-0 bg-black/60 z-40"
              onClick={() => setActiveDrawer(null)}
            />
            <aside className="fixed inset-x-0 bottom-0 h-[82dvh] rounded-t-3xl safe-bottom z-50 lg:static lg:h-full lg:w-96 lg:rounded-2xl bg-[#1e1f20] border border-[#3c4043] flex flex-col overflow-hidden shrink-0 animate-sheet-up">
              <div className="w-10 h-1 rounded-full bg-[#5f6368] mx-auto mt-2.5 lg:hidden shrink-0" />
              <div className="px-5 py-3.5 border-b border-[#3c4043] flex items-center justify-between shrink-0">
                <h3 className="text-sm font-semibold text-white">
                  {activeDrawer === "people" &&
                    `Pessoas (${participants.length})`}
                  {activeDrawer === "chat" && "Mensagens na chamada"}
                  {activeDrawer === "ai" && "Assistente IA (Português)"}
                  {activeDrawer === "activities" && "Gravações & Resumo"}
                  {activeDrawer === "security" && "Controles do Organizador"}
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  aria-label="Fechar painel"
                  className="p-2 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs min-h-0">
                {activeDrawer === "people" && (
                  <>
                    <button
                      type="button"
                      onClick={handleNativeShareRoomLink}
                      className="w-full h-11 px-4 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Share2 className="w-4 h-4" />
                      Compartilhar link de convite
                    </button>
                    <div className="space-y-2 pt-2">
                      {participants.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-[#282a2c]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              style={{ backgroundColor: p.avatarColor }}
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                            >
                              {p.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-white truncate">
                                {p.name}
                              </div>
                              <div className="text-[11px] text-[#9aa0a6]">
                                {p.role === "HOST"
                                  ? "Organizador da reunião"
                                  : "Participante"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {p.isCameraOff ? (
                              <VideoOff className="w-4 h-4 text-[#9aa0a6]" />
                            ) : (
                              <Video className="w-4 h-4 text-[#81c995]" />
                            )}
                            {p.isMuted ? (
                              <MicOff className="w-4 h-4 text-[#f28b82]" />
                            ) : (
                              <Mic className="w-4 h-4 text-[#81c995]" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {activeDrawer === "chat" && (
                  <div className="flex flex-col h-full justify-between gap-3">
                    <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
                      {chatMessages.map((m) => (
                        <div key={m.id} className="bg-[#282a2c] rounded-xl p-3">
                          <div className="flex items-center justify-between text-[11px] text-[#9aa0a6] mb-1">
                            <span className="font-semibold text-white">
                              {m.senderName}
                            </span>
                            <span>{m.timestamp}</span>
                          </div>
                          <p className="text-[#e3e3e3] leading-relaxed break-words">
                            {m.text}
                          </p>
                        </div>
                      ))}
                    </div>
                    <form
                      onSubmit={handleSendChat}
                      className="flex gap-2 pt-1 shrink-0"
                    >
                      <input
                        type="text"
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        placeholder="Enviar mensagem..."
                        className="flex-1 bg-[#282a2c] border border-[#3c4043] rounded-full px-4 py-2.5 text-base sm:text-xs text-white focus:outline-none focus:border-[#a8c7fa]"
                      />
                      <button
                        type="submit"
                        className="h-11 px-5 rounded-full bg-[#0b57d0] text-white font-semibold shrink-0 cursor-pointer"
                      >
                        Enviar
                      </button>
                    </form>
                  </div>
                )}

                {activeDrawer === "ai" && (
                  <div className="space-y-3">
                    <form onSubmit={handleSendAiPrompt} className="flex gap-2">
                      <input
                        type="text"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Perguntar para IA..."
                        className="flex-1 bg-[#282a2c] border border-[#3c4043] rounded-full px-4 py-2.5 text-base sm:text-xs text-white focus:outline-none focus:border-[#a8c7fa]"
                      />
                      <button
                        type="submit"
                        className="h-11 px-4 rounded-full bg-[#0b57d0] text-white font-semibold shrink-0 cursor-pointer"
                      >
                        Pedir
                      </button>
                    </form>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleSendAiPrompt(
                            undefined,
                            "Resuma a discussão até agora"
                          )
                        }
                        className="bg-[#282a2c] hover:bg-[#3c4043] text-[#a8c7fa] px-3.5 py-2 rounded-full text-xs cursor-pointer"
                      >
                        ✦ Resumir discussão
                      </button>
                      <button
                        type="button"
                        onClick={handleExportMarkdownMinutes}
                        className="bg-[#1e3a2f] hover:bg-[#274d3e] text-[#81c995] px-3.5 py-2 rounded-full text-xs cursor-pointer"
                      >
                        ⬇ Baixar Ata
                      </button>
                    </div>
                    {aiResponses.map((res, idx) => (
                      <div
                        key={idx}
                        className="bg-[#282a2c] border border-[#3c4043] rounded-xl p-3.5 space-y-2"
                      >
                        <div className="font-semibold text-[#a8c7fa]">
                          {res.title} ({res.generatedAt})
                        </div>
                        <pre className="whitespace-pre-wrap font-sans text-[#e3e3e3] leading-relaxed">
                          {res.answer}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

                {activeDrawer === "activities" && (
                  <div className="space-y-3">
                    <div className="bg-[#282a2c] border border-[#3c4043] rounded-xl p-3.5 space-y-2.5">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <Disc className="w-4 h-4 text-[#ea4335]" />
                        Gravação da reunião
                      </div>
                      <p className="text-[11px] text-[#c4c7c5]">
                        Grave a reunião completa com áudio de todos os
                        participantes para assistir ou baixar depois.
                      </p>
                      {!recordingSession ? (
                        <button
                          type="button"
                          onClick={handleStartUnlimitedRecording}
                          className="w-full h-11 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white font-semibold cursor-pointer"
                        >
                          ● Iniciar gravação
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStopAndDownloadRecording}
                          className="w-full h-11 rounded-full bg-[#f28b82] text-[#601410] font-semibold cursor-pointer"
                        >
                          ■ Parar gravação (
                          {formatUnlimitedDuration(activeRecDurationSec)})
                        </button>
                      )}
                    </div>

                    {previewVideoUrl && (
                      <div className="bg-[#282a2c] border border-[#3c4043] rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white">
                            Prévia da gravação
                          </span>
                          <button
                            type="button"
                            onClick={() => setPreviewVideoUrl(null)}
                            className="text-[#9aa0a6] hover:text-white cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <video
                          src={previewVideoUrl}
                          controls
                          playsInline
                          className="w-full rounded-lg bg-black max-h-44"
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleExportMarkdownMinutes}
                      className="w-full h-11 px-4 rounded-xl bg-[#282a2c] hover:bg-[#3c4043] text-white font-medium flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#a8c7fa]" />
                      Exportar resumo e transcrição
                    </button>

                    <div className="pt-2">
                      <div className="font-semibold text-[#9aa0a6] uppercase tracking-wider text-[10px] mb-2">
                        Gravações recentes ({savedRecordings.length})
                      </div>
                      {savedRecordings.map((rec) => {
                        const ext = getRecordingFileExtension(rec.mimeType);
                        return (
                          <div
                            key={rec.sessionId}
                            className="bg-[#282a2c] rounded-xl p-3 mb-2 flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-medium text-white">
                                {rec.roomCode}
                              </div>
                              <div className="text-[10px] text-[#9aa0a6]">
                                {formatUnlimitedDuration(rec.durationSeconds)} •{" "}
                                {formatRecordingBytes(rec.totalBytes)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                title="Reproduzir gravação"
                                onClick={async () => {
                                  const blob =
                                    await assembleRecordingBlobFromVault(
                                      rec.sessionId,
                                      rec.mimeType
                                    );
                                  if (blob) {
                                    const url = URL.createObjectURL(blob);
                                    setPreviewVideoUrl(url);
                                  }
                                }}
                                className="w-9 h-9 rounded-full bg-[#1e3a2f] text-[#81c995] flex items-center justify-center cursor-pointer"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                title="Baixar gravação"
                                onClick={async () => {
                                  const blob =
                                    await assembleRecordingBlobFromVault(
                                      rec.sessionId,
                                      rec.mimeType
                                    );
                                  if (blob) {
                                    triggerBlobDownload(
                                      blob,
                                      `freeting-${rec.roomCode}-${rec.sessionId}.${ext}`
                                    );
                                  }
                                }}
                                className="w-9 h-9 rounded-full bg-[#0b57d0] text-white flex items-center justify-center cursor-pointer"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeDrawer === "security" && (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-[#282a2c] flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-white">
                          Bloquear entrada na sala
                        </div>
                        <div className="text-[11px] text-[#9aa0a6]">
                          Sinalizar sala bloqueada aos participantes
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isRoomLocked}
                        onChange={(e) => {
                          const nextLocked = e.target.checked;
                          setIsRoomLocked(nextLocked);
                          webrtcEngineRef.current?.setRoomLocked(nextLocked);
                          showToast(
                            nextLocked
                              ? "Sala bloqueada pelo organizador"
                              : "Sala desbloqueada"
                          );
                        }}
                        className="w-5 h-5 accent-[#a8c7fa] shrink-0"
                      />
                    </div>
                    <div className="p-3.5 rounded-xl bg-[#282a2c] flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-white">
                          Proteção de Dados Pessoais (LGPD)
                        </div>
                        <div className="text-[11px] text-[#9aa0a6]">
                          Mascarar CPF, e-mail e telefone no chat e legendas
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={lgpdAutoMask}
                        onChange={(e) => {
                          setLgpdAutoMask(e.target.checked);
                          saveLgpdConsent({
                            autoMaskPersonalData: e.target.checked,
                          });
                          showToast(
                            e.target.checked
                              ? "Mascaramento automático LGPD ativado"
                              : "Mascaramento automático LGPD desativado"
                          );
                        }}
                        className="w-5 h-5 accent-[#a8c7fa] shrink-0"
                      />
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ========================================================================
          MOBILE ERGONOMIC 5-BUTTON DOCK (< md) — Thumb-Perfect & Zero Overflow
         ======================================================================== */}
      <footer className="md:hidden h-18 px-3 flex items-center justify-center shrink-0 relative">
        {showReactionBar && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[#282a2c] border border-[#3c4043] rounded-full px-3.5 py-2 flex items-center gap-2.5 shadow-2xl z-40">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  const localSender =
                    displayName.trim() ||
                    (isCreatorRole ? "Organizador" : "Participante");
                  spawnReaction(emoji, localSender);
                  webrtcEngineRef.current?.broadcast({
                    type: "REACTION",
                    emoji,
                    senderName: localSender,
                  });
                }}
                className="text-2xl active:scale-125 transition-transform cursor-pointer px-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between w-full max-w-sm bg-[#1e1f20] border border-[#3c4043]/80 rounded-full px-3 py-2 shadow-xl">
          {/* 1. Mic */}
          <button
            type="button"
            onClick={handleToggleMic}
            aria-pressed={!isMuted}
            aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors relative cursor-pointer ${
              isMuted
                ? "bg-[#ea4335] text-white"
                : "bg-[#0b57d0] text-white"
            }`}
          >
            {isMuted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* 2. Camera */}
          <button
            type="button"
            onClick={handleToggleCamera}
            aria-pressed={!isCameraOff}
            aria-label={isCameraOff ? "Ativar câmera" : "Desativar câmera"}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isCameraOff
                ? "bg-[#ea4335] text-white"
                : "bg-[#0b57d0] text-white"
            }`}
          >
            {isCameraOff ? (
              <VideoOff className="w-5 h-5" />
            ) : (
              <Video className="w-5 h-5" />
            )}
          </button>

          {/* 3. Reactions */}
          <button
            type="button"
            onClick={() => setShowReactionBar((v) => !v)}
            aria-label="Reações"
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              showReactionBar
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "bg-[#282a2c] text-[#e3e3e3]"
            }`}
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* 4. Mobile All-Tools Sheet Trigger */}
          <button
            type="button"
            onClick={() => setShowMobileToolsSheet(true)}
            aria-label="Mais ferramentas da reunião"
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors relative cursor-pointer ${
              recordingSession || isHandRaised || isCaptionsOn
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "bg-[#282a2c] text-[#e3e3e3]"
            }`}
          >
            <MoreVertical className="w-5 h-5" />
            {recordingSession && (
              <span className="w-2.5 h-2.5 rounded-full bg-[#ea4335] absolute top-1 right-1" />
            )}
          </button>

          {/* 5. Prominent Red Hangup Pill */}
          <button
            type="button"
            onClick={handleEndCall}
            aria-label="Sair da chamada"
            className="w-15 h-12 rounded-full bg-[#ea4335] active:bg-[#d93025] text-white flex items-center justify-center shadow-md cursor-pointer"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </footer>

      {/* MOBILE ALL-TOOLS ACTION SHEET */}
      {showMobileToolsSheet && (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 bg-black/60 z-50 flex items-end"
          onClick={() => setShowMobileToolsSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-[#1e1f20] border-t border-[#3c4043] rounded-t-3xl p-5 safe-bottom space-y-4 animate-sheet-up"
          >
            <div className="w-10 h-1 rounded-full bg-[#5f6368] mx-auto" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Controles e Ferramentas
              </h3>
              <button
                type="button"
                onClick={() => setShowMobileToolsSheet(false)}
                className="p-1.5 rounded-full hover:bg-[#282a2c] text-[#c4c7c5]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  unlockAndNudgeRemoteAudio();
                  showToast("Áudio da chamada sincronizado e ativo");
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <Volume2 className="w-5 h-5 text-[#81c995]" />
                <span>Ativar Som</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  handleFlipMobileCamera();
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <RefreshCw className="w-5 h-5 text-[#a8c7fa]" />
                <span>Virar Câmera</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  refreshMediaDevices();
                  setShowMobileDeviceModal(true);
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <Sliders className="w-5 h-5 text-[#a8c7fa]" />
                <span>Dispositivos</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  if (!recordingSession) handleStartUnlimitedRecording();
                  else handleStopAndDownloadRecording();
                }}
                className={`p-3 rounded-2xl flex flex-col items-center gap-2 font-medium cursor-pointer ${
                  recordingSession
                    ? "bg-[#ea4335] text-white"
                    : "bg-[#282a2c] text-white"
                }`}
              >
                <Disc className="w-5 h-5" />
                <span>{recordingSession ? "Parar Gravação" : "Gravar"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  handleToggleHandRaise();
                }}
                className={`p-3 rounded-2xl flex flex-col items-center gap-2 font-medium cursor-pointer ${
                  isHandRaised
                    ? "bg-[#fbbc04] text-[#1f1f1f]"
                    : "bg-[#282a2c] text-white"
                }`}
              >
                <Hand className="w-5 h-5" />
                <span>{isHandRaised ? "Abaixar Mão" : "Levantar Mão"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  handleToggleCaptions();
                }}
                className={`p-3 rounded-2xl flex flex-col items-center gap-2 font-medium cursor-pointer ${
                  isCaptionsOn
                    ? "bg-[#a8c7fa] text-[#041e49]"
                    : "bg-[#282a2c] text-white"
                }`}
              >
                <Captions className="w-5 h-5" />
                <span>Legendas</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  setActiveDrawer("ai");
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <Sparkles className="w-5 h-5 text-[#a8c7fa]" />
                <span>Assistente IA</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  setActiveDrawer("activities");
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <LayoutGrid className="w-5 h-5 text-[#c4c7c5]" />
                <span>Gravações</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsSheet(false);
                  setActiveDrawer("security");
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <Lock className="w-5 h-5 text-[#c4c7c5]" />
                <span>Segurança</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE AUDIO/VIDEO DEVICE MODAL */}
      {showMobileDeviceModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setShowMobileDeviceModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-[#1e1f20] border border-[#3c4043] rounded-t-3xl sm:rounded-3xl p-5 safe-bottom space-y-4 text-xs text-white animate-sheet-up"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Áudio, Microfone e Câmera
              </h3>
              <button
                type="button"
                onClick={() => setShowMobileDeviceModal(false)}
                className="p-1.5 rounded-full hover:bg-[#282a2c]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#282a2c] rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#c4c7c5]">Nível do seu microfone</span>
                <span className="text-[#81c995] font-semibold">
                  {isMuted ? "Desativado" : "Captando"}
                </span>
              </div>
              <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                <div
                  style={{ width: `${isMuted ? 0 : Math.max(6, micInputLevel)}%` }}
                  className="h-full bg-[#81c995] transition-all duration-75"
                />
              </div>
            </div>

            {audioInputs.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[#9aa0a6] font-medium block">
                  Microfone
                </label>
                <select
                  value={selectedMicId}
                  onChange={(e) => handleSelectMicDevice(e.target.value)}
                  className="w-full bg-[#282a2c] border border-[#3c4043] rounded-xl px-3 py-2.5 text-sm text-white"
                >
                  {audioInputs.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {videoInputs.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[#9aa0a6] font-medium block">
                  Câmera
                </label>
                <select
                  value={selectedCamId}
                  onChange={(e) => handleSelectCameraDevice(e.target.value)}
                  className="w-full bg-[#282a2c] border border-[#3c4043] rounded-xl px-3 py-2.5 text-sm text-white"
                >
                  {videoInputs.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                unlockAndNudgeRemoteAudio();
                setShowMobileDeviceModal(false);
                showToast("Saída de som sincronizada!");
              }}
              className="w-full h-11 rounded-full bg-[#0b57d0] text-white font-semibold cursor-pointer"
            >
              Concluir e Sincronizar Áudio
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================
          DESKTOP FULL BOTTOM CONTROL BAR (md:flex)
         ======================================================================== */}
      <footer className="hidden md:flex h-20 px-5 items-center justify-between gap-4 shrink-0 relative">
        <form
          onSubmit={handleSendAiPrompt}
          className="hidden lg:flex items-center bg-[#282a2c] hover:bg-[#323537] border border-[#3c4043] rounded-full h-12 pl-4 pr-2 w-[310px] justify-between transition-colors"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Sparkles className="w-4 h-4 text-[#a8c7fa] shrink-0" />
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Pedir para ..."
              aria-label="Pedir para IA em Português"
              className="bg-transparent text-xs text-white placeholder-[#9aa0a6] focus:outline-none w-full truncate"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="bg-[#1e1f20] text-[#c4c7c5] text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1">
              <Eye className="w-3 h-3" />
              Somente você
            </span>
            <button
              type="submit"
              aria-label="Enviar pergunta para IA"
              className="w-7 h-7 rounded-full bg-[#3c4043] hover:bg-[#0b57d0] text-white flex items-center justify-center cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        <div
          role="toolbar"
          aria-label="Controles de mídia e gravação da reunião"
          className="flex items-center gap-2 mx-auto"
        >
          {/* 1. Split Microphone + Speaker Selector Pill (with Live Input Level!) */}
          <div className="relative flex items-center bg-[#282a2c] rounded-full h-11 p-1 border border-[#3c4043]/60">
            <button
              type="button"
              onClick={() => {
                refreshMediaDevices();
                setOpenDeviceMenu((m) => (m === "mic" ? null : "mic"));
              }}
              title="Selecionar microfone e alto-falante"
              aria-label="Opções de microfone e saída de som"
              className="px-2 h-full rounded-l-full hover:bg-[#3c4043] text-[#c4c7c5] flex items-center cursor-pointer"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleToggleMic}
              aria-pressed={!isMuted}
              aria-label={
                isMuted
                  ? "Ativar microfone (Alt+M)"
                  : "Desativar microfone (Alt+M)"
              }
              className={`w-10 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isMuted
                  ? "bg-[#ea4335] text-white hover:bg-[#d93025]"
                  : "bg-[#0b57d0] text-white"
              }`}
            >
              {isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            {/* Desktop Mic & Speaker Device Picker Popover */}
            {openDeviceMenu === "mic" && (
              <div className="absolute bottom-14 left-0 w-80 bg-[#282a2c] border border-[#3c4043] rounded-2xl p-3.5 shadow-2xl z-50 text-xs space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[#9aa0a6] font-semibold">
                    <span>Nível de entrada do microfone</span>
                    <span className="text-[#81c995]">
                      {isMuted ? "Mudo" : `${micInputLevel}%`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#131314] rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${isMuted ? 0 : Math.max(6, micInputLevel)}%`,
                      }}
                      className="h-full bg-[#81c995] transition-all duration-75"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-[#9aa0a6] px-1">
                    Microfones ({audioInputs.length || 1})
                  </div>
                  {audioInputs.length === 0 ? (
                    <div className="px-2 py-1.5 text-[#c4c7c5]">
                      Ative o microfone para listar dispositivos
                    </div>
                  ) : (
                    audioInputs.map((m) => (
                      <button
                        key={m.deviceId}
                        type="button"
                        onClick={() => handleSelectMicDevice(m.deviceId)}
                        className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 cursor-pointer ${
                          selectedMicId === m.deviceId
                            ? "bg-[#0b57d0]/30 text-[#a8c7fa]"
                            : "hover:bg-[#3c4043] text-white"
                        }`}
                      >
                        <span className="truncate">{m.label}</span>
                        {selectedMicId === m.deviceId && (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>

                {audioOutputs.length > 0 && (
                  <div className="space-y-1 border-t border-[#3c4043] pt-2">
                    <div className="text-[11px] font-semibold text-[#9aa0a6] px-1">
                      Saída de Som / Alto-falantes
                    </div>
                    {audioOutputs.map((s) => (
                      <button
                        key={s.deviceId}
                        type="button"
                        onClick={() => handleSelectSpeakerDevice(s.deviceId)}
                        className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 cursor-pointer ${
                          selectedSpeakerId === s.deviceId
                            ? "bg-[#0b57d0]/30 text-[#a8c7fa]"
                            : "hover:bg-[#3c4043] text-white"
                        }`}
                      >
                        <span className="truncate">{s.label}</span>
                        {selectedSpeakerId === s.deviceId && (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Split Camera Selector Pill */}
          <div className="relative flex items-center bg-[#282a2c] rounded-full h-11 p-1 border border-[#3c4043]/60">
            <button
              type="button"
              onClick={() => {
                refreshMediaDevices();
                setOpenDeviceMenu((m) => (m === "camera" ? null : "camera"));
              }}
              title="Selecionar câmera"
              aria-label="Opções de câmera"
              className="px-2 h-full rounded-l-full hover:bg-[#3c4043] text-[#c4c7c5] flex items-center cursor-pointer"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleToggleCamera}
              aria-pressed={!isCameraOff}
              aria-label={
                isCameraOff
                  ? "Ativar câmera (Alt+V)"
                  : "Desativar câmera (Alt+V)"
              }
              className={`w-10 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isCameraOff
                  ? "bg-[#ea4335] text-white hover:bg-[#d93025]"
                  : "bg-[#0b57d0] text-white"
              }`}
            >
              {isCameraOff ? (
                <VideoOff className="w-4 h-4" />
              ) : (
                <Video className="w-4 h-4" />
              )}
            </button>

            {openDeviceMenu === "camera" && (
              <div className="absolute bottom-14 left-0 w-72 bg-[#282a2c] border border-[#3c4043] rounded-2xl p-3 shadow-2xl z-50 text-xs space-y-1.5">
                <div className="text-[11px] font-semibold text-[#9aa0a6] px-1">
                  Câmeras conectadas ({videoInputs.length || 1})
                </div>
                {videoInputs.length === 0 ? (
                  <div className="px-2 py-1.5 text-[#c4c7c5]">
                    Ative a câmera para listar dispositivos
                  </div>
                ) : (
                  videoInputs.map((c) => (
                    <button
                      key={c.deviceId}
                      type="button"
                      onClick={() => handleSelectCameraDevice(c.deviceId)}
                      className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 cursor-pointer ${
                        selectedCamId === c.deviceId
                          ? "bg-[#0b57d0]/30 text-[#a8c7fa]"
                          : "hover:bg-[#3c4043] text-white"
                      }`}
                    >
                      <span className="truncate">{c.label}</span>
                      {selectedCamId === c.deviceId && (
                        <Check className="w-3.5 h-3.5 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 3. Screen Share */}
          <button
            type="button"
            onClick={handleToggleScreenShare}
            aria-pressed={isScreenSharing}
            title="Apresentar agora (Compartilhar tela)"
            aria-label="Compartilhar tela"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isScreenSharing
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3]"
            }`}
          >
            <MonitorUp className="w-5 h-5" />
          </button>

          {/* 4. Recorder Button */}
          <button
            type="button"
            aria-pressed={!!recordingSession}
            onClick={() => {
              if (!recordingSession) {
                handleStartUnlimitedRecording();
              } else {
                handleStopAndDownloadRecording();
              }
            }}
            title={
              recordingSession
                ? "Parar gravação (Alt+R)"
                : "Gravar reunião (Alt+R)"
            }
            className={`h-11 px-3.5 rounded-full flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
              recordingSession
                ? "bg-[#ea4335] text-white ring-4 ring-[#ea4335]/30"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3]"
            }`}
          >
            <Disc className="w-4 h-4" />
            <span>{recordingSession ? "Parar" : "Gravar"}</span>
          </button>

          {/* 5. Emoji Reactions */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowReactionBar((v) => !v)}
              aria-expanded={showReactionBar}
              title="Enviar reação"
              aria-label="Enviar reação com emoji"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                showReactionBar
                  ? "bg-[#a8c7fa] text-[#041e49]"
                  : "bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3]"
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>

            {showReactionBar && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-[#282a2c] border border-[#3c4043] rounded-full px-3 py-1.5 flex items-center gap-2 shadow-2xl z-40">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      const localSender =
                        displayName.trim() ||
                        (isCreatorRole ? "Organizador" : "Participante");
                      spawnReaction(emoji, localSender);
                      webrtcEngineRef.current?.broadcast({
                        type: "REACTION",
                        emoji,
                        senderName: localSender,
                      });
                    }}
                    className="text-xl hover:scale-125 transition-transform cursor-pointer px-1"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 6. Captions (CC) */}
          <button
            type="button"
            onClick={handleToggleCaptions}
            aria-pressed={isCaptionsOn}
            title="Ativar legendas em Português (CC) (Alt+C)"
            aria-label="Alternar legendas ao vivo em Português"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isCaptionsOn
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3]"
            }`}
          >
            <Captions className="w-5 h-5" />
          </button>

          {/* 7. Raise Hand */}
          <button
            type="button"
            aria-pressed={isHandRaised}
            onClick={handleToggleHandRaise}
            title="Levantar a mão (Alt+H)"
            aria-label="Levantar ou abaixar a mão"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isHandRaised
                ? "bg-[#fbbc04] text-[#1f1f1f]"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3]"
            }`}
          >
            <Hand className="w-5 h-5" />
          </button>

          {/* 8. More Options */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu((v) => !v)}
              title="Mais opções"
              aria-label="Mais opções da sala"
              className="w-11 h-11 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3] flex items-center justify-center cursor-pointer"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {showMoreMenu && (
              <div className="absolute bottom-14 right-0 w-72 bg-[#282a2c] border border-[#3c4043] rounded-2xl py-2 shadow-2xl z-40 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    unlockAndNudgeRemoteAudio();
                    showToast("Áudio da chamada sincronizado");
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <Volume2 className="w-4 h-4 text-[#81c995]" />
                  <span>Sincronizar áudio da sala</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    if (!recordingSession) handleStartUnlimitedRecording();
                    else handleStopAndDownloadRecording();
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <Disc className="w-4 h-4 text-[#ea4335]" />
                  <span>
                    {recordingSession ? "Parar gravação" : "Gravar reunião"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleCopyRoomLink();
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <Copy className="w-4 h-4 text-[#a8c7fa]" />
                  <span>Copiar link da reunião</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowShortcutsModal(true);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <Keyboard className="w-4 h-4 text-[#a8c7fa]" />
                  <span>Atalhos de Teclado e Acessibilidade</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleExportMarkdownMinutes();
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#a8c7fa]" />
                  <span>Baixar resumo da reunião</span>
                </button>
              </div>
            )}
          </div>

          {/* 9. End Call Wide Red Pill Button */}
          <button
            type="button"
            onClick={handleEndCall}
            aria-label="Sair da chamada"
            title="Sair da chamada"
            className="w-16 h-11 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white flex items-center justify-center shadow-md transition-colors cursor-pointer"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        {/* Right: Chat, Activities/Grid, Security Lock Pill */}
        <div className="flex items-center bg-[#1e1f20] border border-[#3c4043]/60 rounded-full px-3 h-11 gap-2">
          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "chat" ? null : "chat"))
            }
            title="Chat da reunião"
            aria-label="Abrir chat da reunião"
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              activeDrawer === "chat"
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "text-[#c4c7c5] hover:bg-[#282a2c]"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "activities" ? null : "activities"))
            }
            title="Atividades e Gravações"
            aria-label="Abrir gravações"
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              activeDrawer === "activities"
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "text-[#c4c7c5] hover:bg-[#282a2c]"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "security" ? null : "security"))
            }
            title="Controles de segurança do organizador"
            aria-label="Controles de segurança"
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              activeDrawer === "security"
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "text-[#c4c7c5] hover:bg-[#282a2c]"
            }`}
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* MODAL: Atalhos de Teclado & Acessibilidade WCAG */}
      {showShortcutsModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-[#1e1f20] border border-[#3c4043] text-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-[#a8c7fa]" />
                Atalhos de Teclado & Acessibilidade
              </h3>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="p-1.5 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                { key: "Alt + M", action: "Ativar / Desativar Microfone" },
                { key: "Alt + V", action: "Ativar / Desativar Câmera" },
                { key: "Alt + R", action: "Iniciar / Parar Gravação" },
                {
                  key: "Alt + C",
                  action: "Ativar / Desativar Legendas em Português (CC)",
                },
                { key: "Alt + H", action: "Levantar / Abaixar a Mão" },
                { key: "?", action: "Abrir este Guia de Acessibilidade" },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#282a2c]"
                >
                  <span className="text-[#e3e3e3]">{item.action}</span>
                  <kbd className="bg-[#131314] border border-[#3c4043] px-2.5 py-1 rounded-lg font-mono text-[#a8c7fa]">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-xs font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
