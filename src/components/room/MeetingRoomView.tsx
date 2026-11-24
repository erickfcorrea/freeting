"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
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
  ChevronLeft,
  ChevronRight,
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
  EyeOff,
  Keyboard,
  Contrast,
  Share2,
  RefreshCw,
  Volume2,
  VolumeX,
  Sliders,
  Zap,
  ShieldCheck,
  ZoomIn,
  Trash2,
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
  LGPD_ROPA_OPERATIONS,
} from "@/domain/lgpdCompliance";

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👏", "😂", "😮"];
const MAX_CONCURRENT_REACTIONS = 10;
const MAX_STORED_CAPTIONS = 120;

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
export type DesktopGridDensity = 4 | 9 | 16;

interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

/**
 * Isolated Header Clock: ticks independently so the video stage never re-renders on clock updates.
 */
const LiveHeaderClock = memo(function LiveHeaderClock() {
  const [text, setText] = useState(() =>
    new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  useEffect(() => {
    const update = () => {
      setText(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    };
    update();
    const id = setInterval(update, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="hidden sm:inline text-sm font-medium text-[#e3e3e3]">
      {text}
    </span>
  );
});

/**
 * Isolated Recording Pill Timer: only ticks 1s when an active recording session exists,
 * preventing 1Hz re-renders across the entire room and participant tiles.
 */
const ActiveRecordingPill = memo(function ActiveRecordingPill({
  session,
  onPauseResume,
  onStop,
}: {
  session: UnlimitedRecordingSession;
  onPauseResume: () => void;
  onStop: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const durationSec = Math.floor(
    getEffectiveRecordingDurationMs(session, nowMs) / 1000
  );

  return (
    <div className="flex items-center gap-1.5 bg-[#3c1917] border border-[#f28b82]/50 text-[#f28b82] rounded-full px-2.5 sm:px-3.5 py-1 text-[11px] sm:text-xs font-medium shrink-0">
      <span className="w-2 h-2 rounded-full bg-[#ea4335] animate-pulse" />
      <span>{formatUnlimitedDuration(durationSec, false)}</span>
      <button
        type="button"
        onClick={onPauseResume}
        title={
          session.state === "PAUSED" ? "Retomar gravação" : "Pausar gravação"
        }
        aria-label={
          session.state === "PAUSED" ? "Retomar gravação" : "Pausar gravação"
        }
        className="p-0.5 hover:text-white cursor-pointer"
      >
        {session.state === "PAUSED" ? (
          <Play className="w-3.5 h-3.5" />
        ) : (
          <Pause className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onStop}
        title="Parar e salvar gravação"
        aria-label="Parar e salvar gravação"
        className="p-0.5 hover:text-white cursor-pointer"
      >
        <Square className="w-3.5 h-3.5 fill-current" />
      </button>
    </div>
  );
});

/**
 * Always-mounted Remote Audio Renderer (decoupled from visual video tiles).
 * Guarantees uninterrupted voice audio even during pagination, spotlight, or low-data mode.
 */
const RemoteAudioTrackPlayer = memo(function RemoteAudioTrackPlayer({
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
});

/**
 * Pure visual Remote Video Renderer (strictly muted so mobile browsers NEVER block video autoplay).
 */
const RemoteVideoSurface = memo(function RemoteVideoSurface({
  stream,
  fitMode = "cover",
  zoomScale = 1,
}: {
  stream?: MediaStream | null;
  fitMode?: "cover" | "contain";
  zoomScale?: number;
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
      style={
        zoomScale > 1
          ? { transform: `scale(${zoomScale})`, transformOrigin: "center center" }
          : undefined
      }
      className={`w-full h-full transition-transform duration-200 ${
        fitMode === "contain" ? "object-contain bg-black" : "object-cover"
      }`}
    />
  );
});

/**
 * Memoized Participant Tile Card: prevents unnecessary DOM/GPU re-renders in large meetings.
 */
const ParticipantTileCard = memo(function ParticipantTileCard({
  participant,
  isFilmstripTile,
  highContrastMode,
  isCameraOffLocal,
  isVirtualCamera,
  shouldMirrorLocalVideo,
  lowDataMode,
  isPinned,
  bindLocalVideoRef,
  onFlipCamera,
  onTogglePin,
  onToggleFullscreen,
}: {
  participant: RoomParticipant;
  isFilmstripTile: boolean;
  highContrastMode: boolean;
  isCameraOffLocal: boolean;
  isVirtualCamera: boolean;
  shouldMirrorLocalVideo: boolean;
  lowDataMode: boolean;
  isPinned: boolean;
  bindLocalVideoRef: (el: HTMLVideoElement | null) => void;
  onFlipCamera: () => void;
  onTogglePin: (participantId: string) => void;
  onToggleFullscreen: () => void;
}) {
  const showRemoteCameraVideo =
    !participant.isLocal &&
    !participant.isCameraOff &&
    (!lowDataMode || participant.isScreenSharing) &&
    !!participant.stream &&
    participant.stream.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <div
      className={`rounded-2xl relative flex items-center justify-center overflow-hidden shadow-inner group ${
        isFilmstripTile
          ? "w-40 lg:w-full h-full shrink-0"
          : "w-full h-full min-h-0"
      } ${
        highContrastMode
          ? "bg-[#0a192f] border-2 border-yellow-400"
          : participant.isSpeaking && !participant.isMuted
          ? "bg-[#1b3a6b] border-2 border-[#81c995]"
          : isPinned
          ? "bg-[#1b3a6b] border-2 border-[#a8c7fa]"
          : "bg-[#1b3a6b] border border-white/10"
      }`}
    >
      {/* Top-Right Mic Status / Equalizer + Flip Camera on Local Tile */}
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 flex items-center gap-1.5">
        {participant.isLocal && !isCameraOffLocal && !isVirtualCamera && (
          <button
            type="button"
            onClick={onFlipCamera}
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
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 bg-[#fbbc04] text-[#1f1f1f] px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 shadow-md">
          <Hand className="w-3 h-3" />
          <span className="hidden sm:inline">Mão levantada</span>
        </div>
      )}

      {/* Visual Video Surface (Remote or Local) or Avatar */}
      {participant.isLocal && !isCameraOffLocal ? (
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
        <div className="relative flex flex-col items-center justify-center gap-1.5">
          <div
            style={{ backgroundColor: participant.avatarColor }}
            className={`${
              isFilmstripTile
                ? "w-11 h-11 text-base"
                : "w-16 h-16 sm:w-22 sm:h-22 text-2xl sm:text-3xl"
            } rounded-full flex items-center justify-center font-semibold text-white shadow-lg transition-transform ${
              !participant.isMuted ? "ring-4 ring-[#8ab4f8]/70 scale-105" : ""
            }`}
          >
            {participant.name.charAt(0).toUpperCase()}
          </div>
          {!participant.isLocal && lowDataMode && !participant.isCameraOff && (
            <span className="text-[10px] bg-black/50 text-[#a8c7fa] px-2 py-0.5 rounded-full">
              Vídeo pausado (Economia)
            </span>
          )}
        </div>
      )}

      {/* Hover / Tap Pin & Fullscreen Pill */}
      <div className="hidden sm:flex absolute inset-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="pointer-events-auto bg-[#202124]/85 backdrop-blur-xs text-[#e3e3e3] rounded-full px-3 py-1.5 flex items-center gap-3 shadow-md">
          <button
            type="button"
            onClick={onToggleFullscreen}
            title="Tela cheia"
            aria-label="Alternar tela cheia"
            className="hover:text-white cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onTogglePin(participant.id)}
            title={isPinned ? "Desafixar destaque" : "Fixar em destaque"}
            aria-label={isPinned ? "Desafixar destaque" : "Fixar em destaque"}
            className={`hover:text-white cursor-pointer ${
              isPinned ? "text-[#a8c7fa]" : ""
            }`}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom-left Participant Nameplate */}
      <div className="absolute bottom-2 left-2 sm:bottom-2.5 sm:left-3 max-w-[86%] bg-black/65 backdrop-blur-xs px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-medium text-white flex items-center gap-1.5 truncate">
        {isPinned && <Pin className="w-3 h-3 text-[#a8c7fa] shrink-0" />}
        <span className="truncate">{participant.name}</span>
        {!isFilmstripTile && (
          <span className="hidden sm:inline text-[10px] text-[#a8c7fa] shrink-0">
            • {participant.role === "HOST" ? "Organizador" : "Participante"}
          </span>
        )}
      </div>
    </div>
  );
});

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

  const callStartedAtMsRef = useRef<number>(Date.now());
  const [endedDurationSeconds, setEndedDurationSeconds] = useState<number>(0);

  // Media, Device, Performance & Accessibility States
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

  // Screen Share Anti-Mirror & Presentation States
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showLocalScreenPreview, setShowLocalScreenPreview] = useState(false);
  const [presentationZoom, setPresentationZoom] = useState<1 | 1.5 | 2>(1);
  const [hideFilmstripDuringShare, setHideFilmstripDuringShare] =
    useState(false);

  // Multi-Participant Scaling & Performance States
  const [lowDataMode, setLowDataMode] = useState(false);
  const [desktopGridDensity, setDesktopGridDensity] =
    useState<DesktopGridDensity>(9);
  const [galleryPage, setGalleryPage] = useState<number>(0);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(false);

  const [isCaptionsOn, setIsCaptionsOn] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [lgpdAutoMask, setLgpdAutoMask] = useState<boolean>(
    () => loadLgpdConsent().autoMaskPersonalData
  );
  const [lgpdScreenPrivacy, setLgpdScreenPrivacy] = useState<boolean>(
    () => loadLgpdConsent().screenSharePrivacyShield
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

  // Overlays, Unread Counters & Drawers
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
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);

  // Streams & Refs
  const activeDrawerRef = useRef(activeDrawer);
  activeDrawerRef.current = activeDrawer;
  const isScreenSharingRef = useRef(isScreenSharing);
  isScreenSharingRef.current = isScreenSharing;
  const lgpdScreenPrivacyRef = useRef(lgpdScreenPrivacy);
  lgpdScreenPrivacyRef.current = lgpdScreenPrivacy;

  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const lobbyVideoElRef = useRef<HTMLVideoElement | null>(null);
  const screenPreviewElRef = useRef<HTMLVideoElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const toolbarContainerRef = useRef<HTMLDivElement | null>(null);

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

  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>(() => [
    {
      id: "welcome_msg",
      senderId: "system",
      senderName: "FREETING",
      text: "As mensagens enviadas aqui são visíveis para as pessoas na chamada.",
      timestamp: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [captions, setCaptions] = useState<RoomCaptionEntry[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponses, setAiResponses] = useState<AiAssistantResponse[]>([]);

  const [recordingSession, setRecordingSession] =
    useState<UnlimitedRecordingSession | null>(null);
  const [savedRecordings, setSavedRecordings] = useState<StoredRecordingMeta[]>(
    []
  );

  const getElapsedCallSeconds = useCallback(() => {
    return Math.max(
      1,
      Math.floor((Date.now() - callStartedAtMsRef.current) / 1000)
    );
  }, []);

  const getCurrentTimeLabel = () =>
    new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

  /**
   * LGPD Screen-Privacy Aware Toast: suppresses external chat/join popups on presenter's screen
   * while sharing screen with LGPD Screen Privacy Shield enabled.
   */
  const showToast = useCallback((msg: string, isExternalEvent = false) => {
    setA11yLiveText(msg);
    if (
      isExternalEvent &&
      isScreenSharingRef.current &&
      lgpdScreenPrivacyRef.current
    ) {
      return;
    }
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3600);
  }, []);

  // Track responsive viewport breakpoint for adaptive pagination
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Reset unread chat counter when Chat drawer opens & auto-scroll messages
  useEffect(() => {
    if (activeDrawer === "chat") {
      setUnreadChatCount(0);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 60);
    }
  }, [activeDrawer, chatMessages.length]);

  // Close floating popovers on Escape or outside click
  useEffect(() => {
    if (!openDeviceMenu && !showReactionBar && !showMoreMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        toolbarContainerRef.current &&
        !toolbarContainerRef.current.contains(e.target as Node)
      ) {
        setOpenDeviceMenu(null);
        setShowReactionBar(false);
        setShowMoreMenu(null as unknown as boolean);
        setShowMoreMenu(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenDeviceMenu(null);
        setShowReactionBar(false);
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [openDeviceMenu, showReactionBar, showMoreMenu]);

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
      let lastUiMeterUpdateAt = 0;

      const tick = () => {
        if (
          !audioTrack ||
          audioTrack.readyState !== "live" ||
          !audioTrack.enabled
        ) {
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
        const now = Date.now();

        // Throttle UI state updates to ~10fps so React stays idle when menu is closed
        if (now - lastUiMeterUpdateAt > 100) {
          lastUiMeterUpdateAt = now;
          setMicInputLevel((prev) =>
            Math.abs(prev - level) >= 3 ? level : prev
          );
        }

        const speakingNow = level > 8;
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

  // Re-tune WebRTC multi-peer bitrate/QoS automatically whenever participant count or screen-share changes
  useEffect(() => {
    webrtcEngineRef.current?.refreshAllPeersQoS();
  }, [participants.length, isScreenSharing]);

  const refreshVault = useCallback(async () => {
    const list = await listRecordingsFromVault();
    setSavedRecordings(list);
  }, []);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  const muteLocalMicSilently = useCallback(
    (reasonToast?: string) => {
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
      if (reasonToast) {
        showToast(reasonToast);
      }
    },
    [getEffectiveOutboundStream, showToast]
  );

  const spawnReaction = useCallback((emoji: string, senderName = "Você") => {
    const id = `react_${Date.now()}_${Math.random()}`;
    const leftPercent = 18 + Math.floor(Math.random() * 64);
    setReactions((prev) => [
      ...prev.slice(-(MAX_CONCURRENT_REACTIONS - 1)),
      { id, emoji, senderName, leftPercent },
    ]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2600);
  }, []);

  // Connect WebRTC + PeerJS Engine whenever inside the active call
  useEffect(() => {
    if (inPreJoinLobby || isCallEnded) return;

    callStartedAtMsRef.current = Date.now();
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
              showToast(
                `${payload.participant.name} entrou na reunião`,
                true
              );
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
          setAudioWakeTick((t) => t + 1);
        } else if (payload.type === "ROOM_LOCK_STATE") {
          setIsRoomLocked(payload.locked);
        } else if (payload.type === "HOST_MUTE_ALL") {
          muteLocalMicSilently(
            `Microfones silenciados por ${payload.requestedBy}`
          );
        } else if (
          payload.type === "HOST_MUTE_PEER" &&
          payload.targetParticipantId === localId
        ) {
          muteLocalMicSilently(
            `Seu microfone foi silenciado por ${payload.requestedBy}`
          );
        } else if (payload.type === "PEER_LEAVE") {
          setParticipants((prev) => {
            const leaving = prev.find((p) => p.id === payload.participantId);
            if (leaving) {
              showToast(`${leaving.name} saiu da reunião`, true);
            }
            return prev.filter((p) => p.id !== payload.participantId);
          });
          setPinnedParticipantId((prevPin) =>
            prevPin === payload.participantId ? null : prevPin
          );
        } else if (payload.type === "CHAT_MESSAGE") {
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === payload.message.id)) return prev;
            if (activeDrawerRef.current !== "chat") {
              setUnreadChatCount((c) => c + 1);
            }
            return [...prev, payload.message];
          });
        } else if (payload.type === "REACTION") {
          spawnReaction(payload.emoji, payload.senderName);
        } else if (payload.type === "CAPTION") {
          setCaptions((prev) => {
            if (prev.some((c) => c.id === payload.entry.id)) return prev;
            return [...prev.slice(-(MAX_STORED_CAPTIONS - 1)), payload.entry];
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

  const bindScreenPreviewRef = useCallback(
    (el: HTMLVideoElement | null) => {
      screenPreviewElRef.current = el;
      if (el && screenStreamRef.current && isScreenSharing && showLocalScreenPreview) {
        if (el.srcObject !== screenStreamRef.current) {
          el.srcObject = screenStreamRef.current;
        }
        el.muted = true;
        el.play().catch(() => {});
      }
    },
    [isScreenSharing, showLocalScreenPreview]
  );

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
      muteLocalMicSilently("Microfone desativado");
    }
  }, [
    isMuted,
    acquireMicrophoneTrack,
    getEffectiveOutboundStream,
    startMicLevelMonitor,
    unlockAndNudgeRemoteAudio,
    muteLocalMicSilently,
    showToast,
  ]);

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
        if ("contentHint" in newVideoTrack) {
          try {
            newVideoTrack.contentHint = "motion";
          } catch {
            // ignore
          }
        }
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

  /**
   * Anti-Infinite-Mirror Screen Share Engine:
   * - Excludes the FREETING browser tab itself (`selfBrowserSurface: "exclude"`)
   * - Optimizes track sharpness (`contentHint = "detail"`)
   * - Hides full-screen local mirror by default so sharing full monitor NEVER loops infinitely
   */
  const startOrSwitchScreenShare = useCallback(async () => {
    unlockAndNudgeRemoteAudio();

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
      const displayConstraints = {
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: true,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      } as DisplayMediaStreamOptions;

      const displayStream =
        await navigator.mediaDevices.getDisplayMedia(displayConstraints);

      // Stop previous screen stream if switching windows/tabs mid-presentation
      if (screenStreamRef.current) {
        releaseMediaStream(screenStreamRef.current);
      }
      screenStreamRef.current = displayStream;

      const videoTrack = displayStream.getVideoTracks()[0];
      if (videoTrack) {
        if ("contentHint" in videoTrack) {
          try {
            videoTrack.contentHint = "detail";
          } catch {
            // ignore
          }
        }
        videoTrack.onended = () => {
          screenStreamRef.current = null;
          setIsScreenSharing(false);
          setShowLocalScreenPreview(false);
          webrtcEngineRef.current?.updateLocalParticipantMeta({
            isScreenSharing: false,
            isCameraOff,
          });
          setParticipants((prev) =>
            prev.map((p) =>
              p.isLocal ? { ...p, isScreenSharing: false, isCameraOff } : p
            )
          );
          webrtcEngineRef.current?.updateLocalStream(
            getEffectiveOutboundStream()
          );
          showToast("Apresentação de tela encerrada");
        };
      }

      setShowLocalScreenPreview(false);
      setIsScreenSharing(true);
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isScreenSharing: true } : p))
      );
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isScreenSharing: true,
        isCameraOff: false,
      });
      recorderRef.current?.attachAudioStream(displayStream);
      webrtcEngineRef.current?.updateLocalStream(getEffectiveOutboundStream());
      showToast("Apresentando tela (Proteção Anti-Espelho Infinito ativa)");
    } catch {
      if (!isScreenSharing) {
        showToast("Compartilhamento de tela cancelado");
      }
    }
  }, [
    isCameraOff,
    isScreenSharing,
    getEffectiveOutboundStream,
    unlockAndNudgeRemoteAudio,
    showToast,
  ]);

  const stopScreenShare = useCallback(() => {
    releaseMediaStream(screenStreamRef.current);
    screenStreamRef.current = null;
    setIsScreenSharing(false);
    setShowLocalScreenPreview(false);
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
  }, [isCameraOff, getEffectiveOutboundStream, showToast]);

  const handleToggleScreenShare = useCallback(async () => {
    if (!isScreenSharing) {
      await startOrSwitchScreenShare();
    } else {
      stopScreenShare();
    }
  }, [isScreenSharing, startOrSwitchScreenShare, stopScreenShare]);

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
        timestamp: getCurrentTimeLabel(),
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
  }, [roomCode, isScreenSharing, participants, captions, showToast]);

  const handlePauseResumeRecording = useCallback(() => {
    if (!recorderRef.current || !recordingSession) return;
    if (recordingSession.state === "RECORDING") {
      recorderRef.current.pause();
      showToast("Gravação pausada");
    } else if (recordingSession.state === "PAUSED") {
      recorderRef.current.resume();
      showToast("Gravação retomada");
    }
  }, [recordingSession, showToast]);

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
      saveLgpdConsent({ aiTranscriptionConsentGranted: true });
      const localSpeaker = displayName.trim() || "Você";
      const entry: RoomCaptionEntry = {
        id: `cap_${Date.now()}`,
        speakerName: localSpeaker,
        text: "Legendas ao vivo em Português ativadas.",
        timestamp: getCurrentTimeLabel(),
      };
      setCaptions((prev) => [...prev.slice(-119), entry]);
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
                    timestamp: getCurrentTimeLabel(),
                  };
                  setCaptions((prev) => [
                    ...prev.slice(-(MAX_STORED_CAPTIONS - 1)),
                    capEntry,
                  ]);
                  webrtcEngineRef.current?.broadcast({
                    type: "CAPTION",
                    entry: capEntry,
                  });
                }
              }
            };
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
  }, [isCaptionsOn, displayName, lgpdAutoMask, showToast]);

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
      } else if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleToggleScreenShare();
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
    handleToggleScreenShare,
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
      elapsedFormatted: formatUnlimitedDuration(getElapsedCallSeconds()),
      participants: participants.map((p) => p.name),
      captions,
      chatMessages,
      lgpdMaskEnabled: lgpdAutoMask,
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
    const nowTime = getCurrentTimeLabel();

    const msg: RoomChatMessage = {
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: localPeerIdRef.current,
      senderName: localSenderName,
      text: userText,
      timestamp: nowTime,
    };
    setChatMessages((prev) => [...prev, msg]);
    webrtcEngineRef.current?.broadcast({ type: "CHAT_MESSAGE", message: msg });
    setChatDraft("");

    if (isCaptionsOn) {
      const capEntry: RoomCaptionEntry = {
        id: `cap_chat_${Date.now()}`,
        speakerName: localSenderName,
        text: userText,
        timestamp: nowTime,
      };
      setCaptions((prev) => [
        ...prev.slice(-(MAX_STORED_CAPTIONS - 1)),
        capEntry,
      ]);
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
          timestamp: getCurrentTimeLabel(),
        };
        setChatMessages((prev) => [...prev, replyMsg]);
      }, 1200);
    }
  };

  const handleExportMarkdownMinutes = () => {
    const md = exportMeetingMinutesMarkdown({
      roomCode,
      elapsedFormatted: formatUnlimitedDuration(getElapsedCallSeconds()),
      participants: participants.map((p) => p.name),
      captions,
      chatMessages,
      aiNotes: aiResponses,
      lgpdMaskEnabled: lgpdAutoMask,
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, `ata-freeting-${roomCode}.md`);
    showToast("Resumo da reunião exportado com proteção LGPD");
  };

  const handleClearSessionTracesLgpd = () => {
    setChatMessages([
      {
        id: `lgpd_clear_${Date.now()}`,
        senderId: "system",
        senderName: "Central LGPD",
        text: "Histórico local de chat, legendas e anotações limpo pelo titular (Art. 18, VI da LGPD).",
        timestamp: getCurrentTimeLabel(),
      },
    ]);
    setCaptions([]);
    setAiResponses([]);
    showToast("Dados efêmeros locais desta sessão foram eliminados (LGPD)");
  };

  const handleEndCall = async () => {
    setEndedDurationSeconds(getElapsedCallSeconds());
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
    setShowLocalScreenPreview(false);
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

  const handleToggleFullscreen = useCallback(() => {
    if (
      typeof document !== "undefined" &&
      document.documentElement.requestFullscreen
    ) {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    }
  }, []);

  const handleTogglePinParticipant = useCallback((targetId: string) => {
    setPinnedParticipantId((prev) => {
      if (prev === targetId) {
        setLayoutMode("auto");
        return null;
      }
      setLayoutMode("spotlight");
      return targetId;
    });
  }, []);

  const handleHostMuteAll = () => {
    const modName = displayName.trim() || "Organizador";
    webrtcEngineRef.current?.requestMuteAll(modName);
    setParticipants((prev) =>
      prev.map((p) =>
        p.isLocal ? p : { ...p, isMuted: true, isSpeaking: false }
      )
    );
    showToast("Solicitação de silêncio enviada a todos os participantes");
  };

  const handleHostMuteSingle = (target: RoomParticipant) => {
    const modName = displayName.trim() || "Organizador";
    webrtcEngineRef.current?.requestMuteParticipant(target.id, modName);
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === target.id ? { ...p, isMuted: true, isSpeaking: false } : p
      )
    );
    showToast(`Microfone de ${target.name} silenciado`);
  };

  const remoteScreenSharer = useMemo(
    () =>
      participants.find((p) => !p.isLocal && p.isScreenSharing && p.stream) ||
      null,
    [participants]
  );

  const anyPresentationActive = isScreenSharing || !!remoteScreenSharer;

  const raisedHandsCount = useMemo(
    () => participants.filter((p) => p.isHandRaised).length,
    [participants]
  );

  /**
   * Smart Multi-Peer Priority Sort:
   * 1. Pinned Participant
   * 2. Local User ("Você")
   * 3. Active Speakers (`isSpeaking && !isMuted`)
   * 4. Raised Hands (`isHandRaised`)
   * 5. Remaining participants
   */
  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      const score = (p: RoomParticipant) => {
        if (p.id === pinnedParticipantId) return 100;
        if (p.isLocal) return 80;
        if (p.isSpeaking && !p.isMuted) return 60;
        if (p.isHandRaised) return 40;
        if (!p.isCameraOff) return 20;
        return 0;
      };
      return score(b) - score(a);
    });
  }, [participants, pinnedParticipantId]);

  const effectivePageSize = useMemo(() => {
    if (layoutMode === "spotlight" && pinnedParticipantId) return 1;
    if (anyPresentationActive) return 6;
    if (isMobileViewport) return 4;
    return desktopGridDensity;
  }, [
    layoutMode,
    pinnedParticipantId,
    anyPresentationActive,
    isMobileViewport,
    desktopGridDensity,
  ]);

  const totalGalleryPages = Math.max(
    1,
    Math.ceil(sortedParticipants.length / effectivePageSize)
  );
  const safeGalleryPage = Math.min(galleryPage, totalGalleryPages - 1);

  const visibleGridParticipants = useMemo(() => {
    if (layoutMode === "spotlight" && pinnedParticipantId) {
      const found = sortedParticipants.find(
        (p) => p.id === pinnedParticipantId
      );
      if (found) return [found];
    }
    const start = safeGalleryPage * effectivePageSize;
    return sortedParticipants.slice(start, start + effectivePageSize);
  }, [
    layoutMode,
    pinnedParticipantId,
    sortedParticipants,
    safeGalleryPage,
    effectivePageSize,
  ]);

  const hiddenParticipantsCount = Math.max(
    0,
    sortedParticipants.length - visibleGridParticipants.length
  );

  const shouldMirrorLocalVideo =
    cameraFacingMode === "user" && !isVirtualCamera;

  // Dynamic Grid CSS classes optimized for 1..16 visible tiles
  const gridColsClass = useMemo(() => {
    const count = visibleGridParticipants.length;
    if (count <= 1) return "grid-cols-1 grid-rows-1";
    if (count === 2)
      return "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1";
    if (count <= 4) return "grid-cols-2 grid-rows-2";
    if (count <= 6) return "grid-cols-2 md:grid-cols-3 auto-rows-fr";
    if (count <= 9) return "grid-cols-2 md:grid-cols-3 grid-rows-3";
    return "grid-cols-2 md:grid-cols-4 auto-rows-fr";
  }, [visibleGridParticipants.length]);

  // ============================================================================
  // SCREEN 1: PRE-JOIN GREEN ROOM LOBBY ("Pronto para participar?")
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

            <p className="text-[11px] text-[#5f6368] max-w-sm leading-relaxed">
              Conexão P2P protegida com criptografia em trânsito (LGPD). Sem
              necessidade de cadastro ou conta.
            </p>
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
              {formatUnlimitedDuration(endedDurationSeconds)}
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
  // SCREEN 3: ACTIVE MEETING ROOM — Anti-Mirror Stage & Multi-Peer Optimized
  // ============================================================================
  return (
    <div
      className={`h-[100dvh] max-h-[100dvh] w-full safe-top safe-bottom flex flex-col justify-between overflow-hidden select-none ${
        highContrastMode ? "bg-black text-white" : "bg-[#131314] text-white"
      }`}
    >
      {/* ALWAYS-MOUNTED DEDICATED REMOTE AUDIO LAYER */}
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

      {/* MOBILE AUTOPLAY RECOVERY BANNER */}
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

      {/* TOP BAR */}
      <header className="h-13 sm:h-14 px-3 sm:px-5 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <LiveHeaderClock />
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

          <button
            type="button"
            onClick={handleNativeShareRoomLink}
            title="Compartilhar link da sala"
            aria-label="Compartilhar link da sala"
            className="md:hidden w-9 h-9 rounded-full bg-[#282a2c] active:bg-[#3c4043] text-[#a8c7fa] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {recordingSession && (
            <ActiveRecordingPill
              session={recordingSession}
              onPauseResume={handlePauseResumeRecording}
              onStop={handleStopAndDownloadRecording}
            />
          )}
        </div>

        {/* Right Top Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Multi-Peer Performance / Bandwidth Saver Quick Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !lowDataMode;
              setLowDataMode(next);
              showToast(
                next
                  ? "Modo Otimizado (Economia para muitas pessoas) ativado"
                  : "Modo de vídeo HD automático restaurado"
              );
            }}
            title={
              lowDataMode
                ? "Modo Otimizado ativo (clique para restaurar vídeo HD)"
                : "Ativar Modo Otimizado para salas cheias / economia de dados"
            }
            aria-label="Alternar modo otimizado de desempenho"
            className={`w-8 h-8 sm:w-auto sm:px-2.5 sm:h-8 rounded-full flex items-center justify-center gap-1 text-[11px] font-medium cursor-pointer transition-colors ${
              lowDataMode
                ? "bg-[#137333] text-white"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#c4c7c5]"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">
              {lowDataMode ? "Otimizado" : "HD Auto"}
            </span>
          </button>

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

          {/* Mobile Quick Chat Button in Header with Unread Badge */}
          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "chat" ? null : "chat"))
            }
            aria-label="Abrir chat"
            className="md:hidden w-9 h-9 rounded-full bg-[#282a2c] active:bg-[#3c4043] flex items-center justify-center text-[#e3e3e3] relative cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            {unreadChatCount > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#ea4335] text-white text-[10px] font-bold flex items-center justify-center absolute -top-0.5 -right-0.5">
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </span>
            )}
          </button>

          {/* Participants Pill + Raised Hands Counter */}
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
            {raisedHandsCount > 0 && (
              <span
                title={`${raisedHandsCount} pessoa(s) com a mão levantada`}
                className="bg-[#fbbc04] text-[#1f1f1f] text-[10px] font-bold px-1.5 py-0.2 rounded-full flex items-center gap-0.5"
              >
                ✋ {raisedHandsCount}
              </span>
            )}
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

      {/* MAIN VIDEO STAGE + ANTI-MIRROR PRESENTATION STAGE + PAGINATED GALLERY + DRAWERS */}
      <div
        className={`flex-1 px-2.5 sm:px-4 py-1 flex ${
          anyPresentationActive ? "flex-col lg:flex-row" : "flex-row"
        } gap-2.5 sm:gap-3 overflow-hidden relative min-h-0`}
      >
        {/* ====================================================================
            PRESENTATION STAGE:
            1) If YOU are presenting (`isScreenSharing`): renders Anti-Infinite-Mirror
               Presenter Control Deck (NO full-screen loop!).
            2) If REMOTE peer is presenting (`remoteScreenSharer`): renders crisp
               object-contain viewer with Zoom 1x/1.5x/2x + Filmstrip Toggle + Fullscreen.
           ==================================================================== */}
        {anyPresentationActive && (
          <div className="flex-1 bg-[#0d1520] border-2 border-[#a8c7fa]/40 rounded-2xl relative flex flex-col overflow-hidden min-h-0">
            <div className="bg-[#1e1f20]/95 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 border-b border-[#3c4043] shrink-0">
              <span className="text-xs font-medium text-[#a8c7fa] flex items-center gap-2 truncate">
                <MonitorUp className="w-4 h-4 shrink-0" />
                {isScreenSharing
                  ? "Você está apresentando sua tela"
                  : `Apresentação de ${remoteScreenSharer?.name}`}
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Toggle Participant Filmstrip to maximize screen share space */}
                <button
                  type="button"
                  onClick={() => setHideFilmstripDuringShare((v) => !v)}
                  title={
                    hideFilmstripDuringShare
                      ? "Mostrar vídeos dos participantes"
                      : "Expandir apresentação (ocultar miniaturas)"
                  }
                  className="px-2.5 py-1 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3] text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  {hideFilmstripDuringShare ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {hideFilmstripDuringShare
                      ? "Mostrar pessoas"
                      : "Focar tela"}
                  </span>
                </button>

                {isScreenSharing ? (
                  <>
                    <button
                      type="button"
                      onClick={startOrSwitchScreenShare}
                      className="px-2.5 py-1 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-[#a8c7fa] text-[11px] font-medium cursor-pointer"
                    >
                      Trocar janela
                    </button>
                    <button
                      type="button"
                      onClick={stopScreenShare}
                      className="px-3 py-1 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white text-xs font-semibold cursor-pointer"
                    >
                      Parar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPresentationZoom((z) =>
                          z === 1 ? 1.5 : z === 1.5 ? 2 : 1
                        )
                      }
                      title="Aplicar zoom na tela compartilhada"
                      className="px-2.5 py-1 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-white text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                      <span>{Math.round(presentationZoom * 100)}%</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleFullscreen}
                      className="px-2.5 py-1 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-white text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Tela cheia</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {isScreenSharing ? (
              /* ANTI-INFINITE-MIRROR PRESENTER DECK */
              <div className="flex-1 min-h-0 bg-gradient-to-b from-[#111b2b] to-[#0b111b] p-4 sm:p-8 flex flex-col items-center justify-center text-center relative overflow-y-auto">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#0b57d0]/25 border border-[#a8c7fa]/40 flex items-center justify-center text-[#a8c7fa] mb-3 shadow-lg">
                  <MonitorUp className="w-7 h-7 sm:w-8 sm:h-8" />
                </div>

                <h2 className="text-base sm:text-lg font-semibold text-white">
                  Sua tela está sendo transmitida para todos na sala
                </h2>
                <p className="text-xs text-[#c4c7c5] max-w-md mt-1.5 leading-relaxed">
                  O espelho local fica oculto automaticamente para evitar o
                  efeito de <strong>tela infinita</strong> e economizar placa de
                  vídeo. Os outros participantes estão vendo sua apresentação em
                  alta definição.
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
                  <button
                    type="button"
                    onClick={startOrSwitchScreenShare}
                    className="h-10 px-4 rounded-full bg-[#282a2c] hover:bg-[#3c4043] border border-[#3c4043] text-xs font-medium text-white flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#a8c7fa]" />
                    <span>Escolher outra janela / guia</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowLocalScreenPreview((v) => !v)}
                    className="h-10 px-4 rounded-full bg-[#282a2c] hover:bg-[#3c4043] border border-[#3c4043] text-xs font-medium text-[#e3e3e3] flex items-center gap-2 cursor-pointer"
                  >
                    {showLocalScreenPreview ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {showLocalScreenPreview
                        ? "Ocultar miniatura"
                        : "Ver miniatura discreta"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={stopScreenShare}
                    className="h-10 px-5 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-xs font-semibold text-white flex items-center gap-2 shadow-md cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Parar apresentação</span>
                  </button>
                </div>

                {/* LGPD Screen Privacy Shield Quick Pill */}
                <label className="mt-4 inline-flex items-center gap-2 bg-[#1e1f20]/90 border border-[#3c4043] rounded-full px-3.5 py-1.5 text-[11px] text-[#c4c7c5] cursor-pointer">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#81c995] shrink-0" />
                  <span>
                    Escudo LGPD: ocultar avisos do chat na minha tela durante a
                    transmissão
                  </span>
                  <input
                    type="checkbox"
                    checked={lgpdScreenPrivacy}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setLgpdScreenPrivacy(checked);
                      saveLgpdConsent({ screenSharePrivacyShield: checked });
                    }}
                    className="w-4 h-4 accent-[#81c995]"
                  />
                </label>

                {/* Optional Compact Corner Thumbnail (Never full-screen mirror!) */}
                {showLocalScreenPreview && (
                  <div className="mt-4 w-56 aspect-video rounded-xl overflow-hidden border border-[#a8c7fa]/50 bg-black shadow-2xl relative">
                    <video
                      ref={bindScreenPreviewRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 left-1.5 bg-black/75 text-[9px] text-white px-1.5 py-0.5 rounded">
                      Miniatura local
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* REMOTE PRESENTATION VIEWER */
              <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
                <RemoteVideoSurface
                  stream={remoteScreenSharer?.stream}
                  fitMode="contain"
                  zoomScale={presentationZoom}
                />
              </div>
            )}
          </div>
        )}

        {/* PAGINATED & SPEAKER-PRIORITIZED PARTICIPANT VIDEO STAGE */}
        {(!anyPresentationActive || !hideFilmstripDuringShare) && (
          <div
            className={`${
              anyPresentationActive
                ? "h-28 lg:h-full lg:w-72 shrink-0 flex flex-col"
                : "flex-1 flex flex-col min-h-0"
            } gap-2 h-full relative`}
          >
            <div
              className={`${
                anyPresentationActive
                  ? "flex-1 flex flex-row lg:flex-col overflow-x-auto lg:overflow-y-auto no-scrollbar"
                  : `flex-1 grid min-h-0 ${gridColsClass}`
              } gap-2.5 sm:gap-3 h-full`}
            >
              {visibleGridParticipants.map((participant) => (
                <ParticipantTileCard
                  key={participant.id}
                  participant={participant}
                  isFilmstripTile={anyPresentationActive}
                  highContrastMode={highContrastMode}
                  isCameraOffLocal={isCameraOff}
                  isVirtualCamera={isVirtualCamera}
                  shouldMirrorLocalVideo={shouldMirrorLocalVideo}
                  lowDataMode={lowDataMode}
                  isPinned={
                    layoutMode === "spotlight" &&
                    pinnedParticipantId === participant.id
                  }
                  bindLocalVideoRef={bindLocalVideoRef}
                  onFlipCamera={handleFlipMobileCamera}
                  onTogglePin={handleTogglePinParticipant}
                  onToggleFullscreen={handleToggleFullscreen}
                />
              ))}
            </div>

            {/* Multi-Participant Pagination Bar (Appears automatically when room has more people than page size!) */}
            {totalGalleryPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-1 shrink-0">
                <button
                  type="button"
                  disabled={safeGalleryPage === 0}
                  onClick={() => setGalleryPage((p) => Math.max(0, p - 1))}
                  aria-label="Página anterior de participantes"
                  className="w-7 h-7 rounded-full bg-[#282a2c] hover:bg-[#3c4043] disabled:opacity-40 flex items-center justify-center text-white cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-[#c4c7c5] bg-[#1e1f20] border border-[#3c4043] px-3 py-0.5 rounded-full">
                  Página {safeGalleryPage + 1}/{totalGalleryPages}
                  {hiddenParticipantsCount > 0
                    ? ` • +${hiddenParticipantsCount} na sala`
                    : ""}
                </span>
                <button
                  type="button"
                  disabled={safeGalleryPage >= totalGalleryPages - 1}
                  onClick={() =>
                    setGalleryPage((p) =>
                      Math.min(totalGalleryPages - 1, p + 1)
                    )
                  }
                  aria-label="Próxima página de participantes"
                  className="w-7 h-7 rounded-full bg-[#282a2c] hover:bg-[#3c4043] disabled:opacity-40 flex items-center justify-center text-white cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

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
                  {activeDrawer === "security" &&
                    "Segurança, Desempenho & LGPD"}
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
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleNativeShareRoomLink}
                        className="w-full h-10 px-4 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                        Compartilhar link de convite
                      </button>

                      {/* Host Bulk Moderation for Large Rooms */}
                      {isCreatorRole && participants.length > 1 && (
                        <button
                          type="button"
                          onClick={handleHostMuteAll}
                          className="w-full h-9 px-4 rounded-full bg-[#282a2c] hover:bg-[#3c4043] border border-[#3c4043] text-[#f28b82] font-medium flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <VolumeX className="w-4 h-4" />
                          Silenciar microfone de todos
                        </button>
                      )}
                    </div>

                    <div className="space-y-2 pt-2">
                      {sortedParticipants.map((p) => {
                        const isPinned =
                          layoutMode === "spotlight" &&
                          pinnedParticipantId === p.id;
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[#282a2c] gap-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                style={{ backgroundColor: p.avatarColor }}
                                className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                              >
                                {p.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-white truncate flex items-center gap-1">
                                  <span className="truncate">{p.name}</span>
                                  {p.isHandRaised && <span>✋</span>}
                                </div>
                                <div className="text-[11px] text-[#9aa0a6]">
                                  {p.role === "HOST"
                                    ? "Organizador"
                                    : "Participante"}
                                  {p.isScreenSharing ? " • Apresentando" : ""}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleTogglePinParticipant(p.id)}
                                title={
                                  isPinned
                                    ? "Remover destaque"
                                    : "Fixar participante"
                                }
                                className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer ${
                                  isPinned
                                    ? "bg-[#a8c7fa] text-[#041e49]"
                                    : "hover:bg-[#3c4043] text-[#c4c7c5]"
                                }`}
                              >
                                <Pin className="w-3.5 h-3.5" />
                              </button>

                              {isCreatorRole && !p.isLocal && !p.isMuted && (
                                <button
                                  type="button"
                                  onClick={() => handleHostMuteSingle(p)}
                                  title="Silenciar participante"
                                  className="w-7 h-7 rounded-full hover:bg-[#3c4043] text-[#f28b82] flex items-center justify-center cursor-pointer"
                                >
                                  <VolumeX className="w-3.5 h-3.5" />
                                </button>
                              )}

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
                        );
                      })}
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
                      <div ref={chatEndRef} />
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
                          ■ Parar e salvar gravação
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
                    {/* Performance & Multi-Peer Grid Config */}
                    <div className="p-3.5 rounded-xl bg-[#282a2c] space-y-2.5">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-[#81c995]" />
                        Desempenho para Muitas Pessoas
                      </div>
                      <label className="flex items-center justify-between gap-3 cursor-pointer">
                        <div>
                          <div className="text-white font-medium">
                            Modo Economia de Dados / Salas Cheias
                          </div>
                          <div className="text-[11px] text-[#9aa0a6]">
                            Prioriza voz e tela compartilhada pausando câmeras
                            secundárias
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={lowDataMode}
                          onChange={(e) => setLowDataMode(e.target.checked)}
                          className="w-5 h-5 accent-[#81c995] shrink-0"
                        />
                      </label>

                      <div className="pt-1 hidden md:block">
                        <div className="text-[11px] text-[#9aa0a6] mb-1.5">
                          Máximo de vídeos por página no computador:
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([4, 9, 16] as DesktopGridDensity[]).map((num) => (
                            <button
                              key={num}
                              type="button"
                              onClick={() => {
                                setDesktopGridDensity(num);
                                setGalleryPage(0);
                                setLayoutMode("auto");
                                setPinnedParticipantId(null);
                              }}
                              className={`py-1.5 rounded-lg font-medium cursor-pointer ${
                                desktopGridDensity === num &&
                                layoutMode !== "spotlight"
                                  ? "bg-[#0b57d0] text-white"
                                  : "bg-[#1e1f20] text-[#c4c7c5] hover:bg-[#3c4043]"
                              }`}
                            >
                              {num} vídeos
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Room Lock */}
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

                    {/* LGPD Controls */}
                    <div className="p-3.5 rounded-xl bg-[#282a2c] space-y-3">
                      <div className="font-semibold text-[#a8c7fa] flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4" />
                        Conformidade LGPD (Lei nº 13.709/2018)
                      </div>

                      <label className="flex items-center justify-between gap-3 cursor-pointer">
                        <div>
                          <div className="font-medium text-white">
                            Mascaramento Automático DLP
                          </div>
                          <div className="text-[11px] text-[#9aa0a6]">
                            Ocultar CPF, CNPJ, cartão, e-mail e telefone no
                            chat, legendas e atas
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={lgpdAutoMask}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setLgpdAutoMask(checked);
                            saveLgpdConsent({ autoMaskPersonalData: checked });
                            showToast(
                              checked
                                ? "Mascaramento automático LGPD ativado"
                                : "Mascaramento automático LGPD desativado"
                            );
                          }}
                          className="w-5 h-5 accent-[#a8c7fa] shrink-0"
                        />
                      </label>

                      <label className="flex items-center justify-between gap-3 cursor-pointer">
                        <div>
                          <div className="font-medium text-white">
                            Escudo LGPD na Transmissão de Tela
                          </div>
                          <div className="text-[11px] text-[#9aa0a6]">
                            Oculta popups de chat na sua tela enquanto você
                            apresenta
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={lgpdScreenPrivacy}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setLgpdScreenPrivacy(checked);
                            saveLgpdConsent({
                              screenSharePrivacyShield: checked,
                            });
                          }}
                          className="w-5 h-5 accent-[#a8c7fa] shrink-0"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={handleClearSessionTracesLgpd}
                        className="w-full h-9 rounded-full bg-[#3c1917] hover:bg-[#52221f] text-[#f28b82] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Limpar dados efêmeros desta sessão (Art. 18)</span>
                      </button>
                    </div>

                    {/* ROPA Summary (Art. 37 LGPD) */}
                    <div className="p-3.5 rounded-xl bg-[#282a2c] space-y-2">
                      <div className="text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">
                        Registro de Tratamento (Art. 37 LGPD)
                      </div>
                      {LGPD_ROPA_OPERATIONS.map((op) => (
                        <div
                          key={op.id}
                          className="bg-[#1e1f20] rounded-lg p-2.5 space-y-0.5"
                        >
                          <div className="font-medium text-white">
                            {op.feature}
                          </div>
                          <div className="text-[10px] text-[#a8c7fa]">
                            {op.legalBasis}
                          </div>
                          <div className="text-[10px] text-[#9aa0a6]">
                            {op.protectionMeasure}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ========================================================================
          MOBILE ERGONOMIC 5-BUTTON DOCK (< md)
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
          <button
            type="button"
            onClick={handleToggleMic}
            aria-pressed={!isMuted}
            aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors relative cursor-pointer ${
              isMuted ? "bg-[#ea4335] text-white" : "bg-[#0b57d0] text-white"
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

          <button
            type="button"
            onClick={() => setShowMobileToolsSheet(true)}
            aria-label="Mais ferramentas da reunião"
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors relative cursor-pointer ${
              recordingSession || isHandRaised || isCaptionsOn || lowDataMode
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "bg-[#282a2c] text-[#e3e3e3]"
            }`}
          >
            <MoreVertical className="w-5 h-5" />
            {recordingSession && (
              <span className="w-2.5 h-2.5 rounded-full bg-[#ea4335] absolute top-1 right-1" />
            )}
          </button>

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
                  setLowDataMode((v) => !v);
                  showToast(
                    !lowDataMode
                      ? "Modo Otimizado ativado"
                      : "Modo HD restaurado"
                  );
                }}
                className={`p-3 rounded-2xl flex flex-col items-center gap-2 font-medium cursor-pointer ${
                  lowDataMode
                    ? "bg-[#137333] text-white"
                    : "bg-[#282a2c] text-white"
                }`}
              >
                <Zap className="w-5 h-5" />
                <span>{lowDataMode ? "Economia ON" : "Otimizar Rede"}</span>
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
                  setActiveDrawer("security");
                }}
                className="p-3 rounded-2xl bg-[#282a2c] text-white flex flex-col items-center gap-2 font-medium cursor-pointer"
              >
                <ShieldCheck className="w-5 h-5 text-[#81c995]" />
                <span>LGPD & Sala</span>
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
                  style={{
                    width: `${isMuted ? 0 : Math.max(6, micInputLevel)}%`,
                  }}
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
      <footer
        ref={toolbarContainerRef}
        className="hidden md:flex h-20 px-5 items-center justify-between gap-4 shrink-0 relative"
      >
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
              placeholder="Pedir para IA..."
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
          {/* 1. Split Microphone + Speaker Selector Pill */}
          <div className="relative flex items-center bg-[#282a2c] rounded-full h-11 p-1 border border-[#3c4043]/60">
            <button
              type="button"
              onClick={() => {
                refreshMediaDevices();
                setShowReactionBar(false);
                setShowMoreMenu(false);
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

          {/* 2. Split Camera + Layout Density Pill */}
          <div className="relative flex items-center bg-[#282a2c] rounded-full h-11 p-1 border border-[#3c4043]/60">
            <button
              type="button"
              onClick={() => {
                refreshMediaDevices();
                setShowReactionBar(false);
                setShowMoreMenu(false);
                setOpenDeviceMenu((m) => (m === "camera" ? null : "camera"));
              }}
              title="Selecionar câmera e layout de mosaico"
              aria-label="Opções de câmera e layout"
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
              <div className="absolute bottom-14 left-0 w-76 bg-[#282a2c] border border-[#3c4043] rounded-2xl p-3.5 shadow-2xl z-50 text-xs space-y-3">
                <div className="space-y-1">
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

                <div className="border-t border-[#3c4043] pt-2.5 space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#9aa0a6] px-1">
                    Layout da grade (Otimização multiusuário)
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([4, 9, 16] as DesktopGridDensity[]).map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setDesktopGridDensity(num);
                          setGalleryPage(0);
                          setLayoutMode("auto");
                          setPinnedParticipantId(null);
                          setOpenDeviceMenu(null);
                          showToast(`Mosaico ajustado para até ${num} vídeos`);
                        }}
                        className={`py-1.5 rounded-lg font-medium cursor-pointer ${
                          desktopGridDensity === num &&
                          layoutMode !== "spotlight"
                            ? "bg-[#0b57d0] text-white"
                            : "bg-[#1e1f20] text-[#c4c7c5] hover:bg-[#3c4043]"
                        }`}
                      >
                        {num} vídeos
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Screen Share (Alt+S) */}
          <button
            type="button"
            onClick={handleToggleScreenShare}
            aria-pressed={isScreenSharing}
            title={
              isScreenSharing
                ? "Parar transmissão de tela (Alt+S)"
                : "Apresentar agora sem tela infinita (Alt+S)"
            }
            aria-label="Compartilhar tela"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isScreenSharing
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3]"
            }`}
          >
            <MonitorUp className="w-5 h-5" />
          </button>

          {/* 4. Recorder Button (Alt+R) */}
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
              onClick={() => {
                setOpenDeviceMenu(null);
                setShowMoreMenu(false);
                setShowReactionBar((v) => !v);
              }}
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
              onClick={() => {
                setOpenDeviceMenu(null);
                setShowReactionBar(false);
                setShowMoreMenu((v) => !v);
              }}
              title="Mais opções"
              aria-label="Mais opções da sala"
              className="w-11 h-11 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-[#e3e3e3] flex items-center justify-center cursor-pointer"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {showMoreMenu && (
              <div className="absolute bottom-14 right-0 w-76 bg-[#282a2c] border border-[#3c4043] rounded-2xl py-2 shadow-2xl z-40 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setLowDataMode((v) => !v);
                    showToast(
                      !lowDataMode
                        ? "Modo Otimizado para muitas pessoas ativado"
                        : "Modo de vídeo HD restaurado"
                    );
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-[#81c995]" />
                  <span>
                    {lowDataMode
                      ? "Desativar Economia de Dados"
                      : "Modo Otimizado (Salas Cheias)"}
                  </span>
                </button>
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
                    setActiveDrawer("security");
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-[#81c995]" />
                  <span>Central de Privacidade LGPD & Grade</span>
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

        {/* Right: Chat (with unread badge!), Activities/Grid, Security & LGPD Pill */}
        <div className="flex items-center bg-[#1e1f20] border border-[#3c4043]/60 rounded-full px-3 h-11 gap-2">
          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "chat" ? null : "chat"))
            }
            title="Chat da reunião"
            aria-label="Abrir chat da reunião"
            className={`p-2 rounded-full transition-colors relative cursor-pointer ${
              activeDrawer === "chat"
                ? "bg-[#a8c7fa] text-[#041e49]"
                : "text-[#c4c7c5] hover:bg-[#282a2c]"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            {unreadChatCount > 0 && activeDrawer !== "chat" && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#ea4335] text-white text-[10px] font-bold flex items-center justify-center absolute -top-1 -right-1">
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </span>
            )}
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
            title="Segurança, Desempenho e Privacidade LGPD"
            aria-label="Controles de segurança e LGPD"
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
          onClick={() => setShowShortcutsModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1e1f20] border border-[#3c4043] text-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
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
                {
                  key: "Alt + S",
                  action: "Compartilhar / Parar Tela (Anti-Espelho)",
                },
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
