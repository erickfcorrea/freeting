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
  Clock,
  FileText,
  Edit3,
  Eye,
  Keyboard,
  Contrast,
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
    greeting: "Olá! Já estou conectada na sala, áudio e vídeo funcionando perfeitamente.",
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

/**
 * RemoteParticipantMedia:
 * Binds and plays incoming WebRTC video and audio tracks from remote participants
 * so real people in different browsers/devices can see and hear each other.
 */
function RemoteParticipantMedia({
  stream,
  isCameraOff,
  isMuted,
}: {
  stream?: MediaStream | null;
  isCameraOff: boolean;
  isMuted: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch(() => {});
    }
  }, [stream, isCameraOff, isMuted]);

  const hasVideoTracks =
    !!stream &&
    !isCameraOff &&
    stream.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <>
      {/* Always render remote audio element (unmuted!) so voice plays continuously */}
      {stream && <audio ref={audioRef} autoPlay playsInline muted={false} />}
      {hasVideoTracks && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      )}
    </>
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

  // If the user opened a shared link or typed a code (initialIsCreator = false),
  // show the Pre-Join Lobby ("Pronto para participar?") first just like Google Meet!
  const [inPreJoinLobby, setInPreJoinLobby] = useState<boolean>(
    !initialIsCreator
  );
  const [displayName, setDisplayName] = useState<string>(() =>
    initialIsCreator ? "Organizador" : ""
  );
  const [isCreatorRole, setIsCreatorRole] =
    useState<boolean>(initialIsCreator);

  // Clock & Elapsed Duration
  const [clockText, setClockText] = useState("18:32");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Media & Accessibility States
  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [isVirtualCamera, setIsVirtualCamera] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCaptionsOn, setIsCaptionsOn] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [lgpdAutoMask, setLgpdAutoMask] = useState<boolean>(
    () => loadLgpdConsent().autoMaskPersonalData,
  );
  const [isCallEnded, setIsCallEnded] = useState(false);
  const [highContrastMode, setHighContrastMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState<StageLayoutMode>("auto");
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [a11yLiveText, setA11yLiveText] = useState(
    `Conectado à sala ${roomCode}.`
  );

  // Overlays & Cards: ONLY the Creator sees "Sua reunião está pronta" automatically!
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
  const speechRecognitionRef = useRef<{ stop: () => void } | null>(null);
  const webrtcEngineRef = useRef<FreetingWebRtcRoomEngine | null>(null);
  const recorderRef = useRef<LiveUnlimitedMediaRecorder | null>(null);
  const localPeerIdRef = useRef<string>(
    `peer_${Math.random().toString(36).slice(2, 9)}`,
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

  // Recording State
  const [recordingSession, setRecordingSession] =
    useState<UnlimitedRecordingSession | null>(null);
  const [recordingTickMs, setRecordingTickMs] = useState<number>(Date.now());
  const [savedRecordings, setSavedRecordings] = useState<StoredRecordingMeta[]>(
    [],
  );

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setA11yLiveText(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const navigateBackHome = useCallback(() => {
    if (onLeaveToHome) {
      onLeaveToHome();
    } else {
      router.push("/");
    }
  }, [onLeaveToHome, router]);

  // Shareable URL that actually points to this live deployment
  const realShareableLink = formatShareableLink(
    roomCode,
    typeof window !== "undefined" ? window.location.origin : undefined
  );

  // Update clock and call duration every second
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockText(
        now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      );
    };
    updateClock();
    const timer = setInterval(() => {
      updateClock();
      if (!inPreJoinLobby) {
        setElapsedSeconds((prev) => prev + 1);
      }
      setRecordingTickMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [inPreJoinLobby]);

  const refreshVault = useCallback(async () => {
    const list = await listRecordingsFromVault();
    setSavedRecordings(list);
  }, []);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  // Connect Dual-Transport WebRTC Engine (PeerJS Cloud + BroadcastChannel) ONCE the user enters the room (after Pre-Join Lobby)
  useEffect(() => {
    if (inPreJoinLobby) return;

    const localId = localPeerIdRef.current;
    const effectiveName = displayName.trim()
      ? displayName.trim()
      : isCreatorRole
      ? "Organizador"
      : `Participante ${localId.slice(-3).toUpperCase()}`;

    // Update our local tile name
    setParticipants((prev) =>
      prev.map((p) =>
        p.isLocal
          ? {
              ...p,
              id: localId,
              name: `${effectiveName} (Você)`,
              role: isCreatorRole ? "HOST" : "PARTICIPANT",
            }
          : p
      )
    );

    const engine = new FreetingWebRtcRoomEngine({
      roomCode,
      localId,
      onRoleResolved: (resolvedRole) => {
        const isHostNow = resolvedRole === "HOST";
        setIsCreatorRole(isHostNow);
        if (!isHostNow) {
          // If another user is already the Host of this room, hide the Creator invite card!
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
            // Automatically hide the initial invite card once another participant is in the room
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
              p.id === payload.participantId ? { ...p, ...payload.patch } : p,
            ),
          );
        } else if (payload.type === "PEER_LEAVE") {
          setParticipants((prev) => {
            const leaving = prev.find((p) => p.id === payload.participantId);
            if (leaving) {
              showToast(`${leaving.name} saiu da reunião`);
            }
            return prev.filter((p) => p.id !== payload.participantId);
          });
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
        setParticipants((prev) =>
          prev.map((p) => (p.id === peerId ? { ...p, stream } : p)),
        );
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
        isScreenSharing: false,
        isHandRaised: false,
        isSpeaking: !isMuted,
        avatarColor: pickAvatarColor(effectiveName + localId),
        joinedAtIso: new Date().toISOString(),
      },
      localStreamRef.current,
      isCreatorRole
    );

    return () => {
      engine.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPreJoinLobby, roomCode]);

  // Cleanup all streams on unmount
  useEffect(() => {
    return () => {
      if (stopVirtualCamRef.current) {
        stopVirtualCamRef.current();
        stopVirtualCamRef.current = null;
      }
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
        el.srcObject = localStreamRef.current;
        el.play().catch(() => {});
      }
    },
    [isCameraOff],
  );

  const bindLobbyVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      lobbyVideoElRef.current = el;
      if (el && localStreamRef.current && !isCameraOff) {
        el.srcObject = localStreamRef.current;
        el.play().catch(() => {});
      }
    },
    [isCameraOff]
  );

  const bindScreenVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      screenVideoElRef.current = el;
      if (el && screenStreamRef.current && isScreenSharing) {
        el.srcObject = screenStreamRef.current;
        el.play().catch(() => {});
      }
    },
    [isScreenSharing],
  );

  const spawnReaction = (emoji: string, senderName = "Você") => {
    const id = `react_${Date.now()}_${Math.random()}`;
    const leftPercent = 25 + Math.floor(Math.random() * 50);
    setReactions((prev) => [...prev, { id, emoji, senderName, leftPercent }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2600);
  };

  // Toggle Microphone
  const handleToggleMic = useCallback(async () => {
    if (isMuted) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (localStreamRef.current) {
          // Remove old ended audio tracks and add live audio track
          localStreamRef.current
            .getAudioTracks()
            .forEach((old) => localStreamRef.current?.removeTrack(old));
          audioStream.getAudioTracks().forEach((t) => {
            localStreamRef.current?.addTrack(t);
          });
        } else {
          localStreamRef.current = audioStream;
        }
        webrtcEngineRef.current?.updateLocalStream(localStreamRef.current);
        showToast("Microfone ativado");
      } catch {
        showToast("Microfone ativado (modo simulado)");
      }
      setIsMuted(false);
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isMuted: false,
        isSpeaking: true,
      });
      setParticipants((prev) =>
        prev.map((p) =>
          p.isLocal ? { ...p, isMuted: false, isSpeaking: true } : p,
        ),
      );
    } else {
      localStreamRef.current
        ?.getAudioTracks()
        .forEach((t) => (t.enabled = false));
      setIsMuted(true);
      showToast("Microfone desativado");
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isMuted: true,
        isSpeaking: false,
      });
      setParticipants((prev) =>
        prev.map((p) =>
          p.isLocal ? { ...p, isMuted: true, isSpeaking: false } : p,
        ),
      );
    }
  }, [isMuted, showToast]);

  // Toggle Camera
  const handleToggleCamera = useCallback(async () => {
    if (isCameraOff) {
      let videoStream: MediaStream | null = null;
      let usingVirtual = false;
      const labelName = displayName.trim() || "Você";

      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: !isMuted,
        });
      } catch {
        const virtualCam = createVirtualCameraStream(labelName, roomCode);
        videoStream = virtualCam.stream;
        stopVirtualCamRef.current = virtualCam.stopVirtualCamera;
        usingVirtual = true;
      }

      // Preserve existing live audio tracks if already unmuted
      if (
        localStreamRef.current &&
        localStreamRef.current.getAudioTracks().length > 0 &&
        videoStream &&
        videoStream.getAudioTracks().length === 0
      ) {
        localStreamRef.current
          .getAudioTracks()
          .forEach((at) => videoStream?.addTrack(at));
      }

      localStreamRef.current = videoStream;
      setIsVirtualCamera(usingVirtual);
      setIsCameraOff(false);
      webrtcEngineRef.current?.updateLocalStream(videoStream);
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isCameraOff: false,
      });
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isCameraOff: false } : p)),
      );

      if (localVideoElRef.current && videoStream) {
        localVideoElRef.current.srcObject = videoStream;
        localVideoElRef.current.play().catch(() => {});
      }
      if (lobbyVideoElRef.current && videoStream) {
        lobbyVideoElRef.current.srcObject = videoStream;
        lobbyVideoElRef.current.play().catch(() => {});
      }

      showToast(
        usingVirtual
          ? "Câmera Studio HD ativada (sem webcam física detectada)"
          : "Câmera ativada"
      );
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
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isCameraOff: true,
      });
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isCameraOff: true } : p)),
      );
      showToast("Câmera desativada");
    }
  }, [isCameraOff, isMuted, displayName, roomCode, showToast]);

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        screenStreamRef.current = displayStream;
        const videoTrack = displayStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            setIsScreenSharing(false);
            screenStreamRef.current = null;
            webrtcEngineRef.current?.updateLocalParticipantMeta({
              isScreenSharing: false,
            });
            if (localStreamRef.current) {
              webrtcEngineRef.current?.updateLocalStream(
                localStreamRef.current
              );
            }
            showToast("Apresentação de tela encerrada");
          };
        }
        setIsScreenSharing(true);
        webrtcEngineRef.current?.updateLocalParticipantMeta({
          isScreenSharing: true,
          isCameraOff: false,
        });
        webrtcEngineRef.current?.updateLocalStream(displayStream);
        if (screenVideoElRef.current) {
          screenVideoElRef.current.srcObject = displayStream;
          screenVideoElRef.current.play().catch(() => {});
        }
        showToast("Apresentando sua tela para todos na sala");
      } catch {
        showToast("Compartilhamento de tela cancelado");
      }
    } else {
      releaseMediaStream(screenStreamRef.current);
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      webrtcEngineRef.current?.updateLocalParticipantMeta({
        isScreenSharing: false,
        isCameraOff,
      });
      if (localStreamRef.current) {
        webrtcEngineRef.current?.updateLocalStream(localStreamRef.current);
      }
      showToast("Apresentação de tela encerrada");
    }
  };

  // Start / Pause / Resume / Stop Recording
  const handleStartUnlimitedRecording = useCallback(async () => {
    try {
      const recorder = new LiveUnlimitedMediaRecorder(roomCode, (updated) => {
        setRecordingSession({ ...updated });
      });
      recorderRef.current = recorder;

      const primaryStream = isScreenSharing
        ? screenStreamRef.current
        : localStreamRef.current;

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
      showToast("Erro ao iniciar gravação no navegador.");
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

  // Toggle Live Captions (pt-BR)
  const handleToggleCaptions = useCallback(() => {
    const next = !isCaptionsOn;
    setIsCaptionsOn(next);

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
      showToast("Legendas em Português (CC) ativadas");

      if (typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SpeechRec =
          (window as any).SpeechRecognition ||
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
                  lgpdAutoMask,
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
            recognition.start();
            speechRecognitionRef.current = recognition;
          } catch {
            // Browser speech recognition not active
          }
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

  // Global Accessible Keyboard Shortcuts
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
        setIsHandRaised((prev) => !prev);
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
    recordingSession,
  ]);

  // Simulate adding a participant for quick testing
  const handleAddSimulatedParticipant = () => {
    const profile =
      SIMULATED_BOT_PROFILES[
        (participants.length - 1) % SIMULATED_BOT_PROFILES.length
      ];
    const botId = `bot_${Date.now()}`;
    const newBot: RoomParticipant = {
      id: botId,
      name: profile.name,
      role: "PARTICIPANT",
      isLocal: false,
      isSimulated: true,
      isMuted: false,
      isCameraOff: true,
      isScreenSharing: false,
      isHandRaised: false,
      isSpeaking: true,
      avatarColor: pickAvatarColor(profile.name),
      joinedAtIso: new Date().toISOString(),
    };
    setParticipants((prev) => [...prev, newBot]);
    setShowReadyCard(false);
    setShowPtToastCard(false);
    showToast(`${profile.name} entrou na reunião`);

    const botMsg: RoomChatMessage = {
      id: `msg_${Date.now()}`,
      senderId: botId,
      senderName: profile.name,
      text: profile.greeting,
      timestamp: clockText,
    };
    setChatMessages((prev) => [...prev, botMsg]);

    const botCaption: RoomCaptionEntry = {
      id: `cap_${Date.now()}`,
      speakerName: profile.name,
      text: profile.greeting,
      timestamp: clockText,
    };
    setCaptions((prev) => [...prev, botCaption]);
  };

  // Send AI Assistant Prompt
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

  // Send Chat Message (broadcasts over BOTH PeerJS DataChannel AND BroadcastChannel!)
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
    if (stopVirtualCamRef.current) {
      stopVirtualCamRef.current();
      stopVirtualCamRef.current = null;
    }
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    releaseMediaStream(localStreamRef.current);
    releaseMediaStream(screenStreamRef.current);
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

  const activeRecDurationSec = recordingSession
    ? Math.floor(
        getEffectiveRecordingDurationMs(recordingSession, recordingTickMs) /
          1000,
      )
    : 0;

  // ============================================================================
  // SCREEN 1: PRE-JOIN GREEN ROOM LOBBY ("Pronto para participar?")
  // Shown whenever a guest opens a shared link or joins via code!
  // ============================================================================
  if (inPreJoinLobby) {
    return (
      <div className="min-h-screen bg-white text-[#1f1f1f] flex flex-col">
        {/* Clean Header */}
        <header className="h-16 px-6 flex items-center justify-between border-b border-[#dadce0]/60">
          <button
            type="button"
            onClick={navigateBackHome}
            className="text-xl font-bold tracking-wider text-[#B8860B] cursor-pointer"
          >
            FREETING
          </button>
          <span className="text-xs text-[#5f6368] font-mono">
            Sala: {roomCode}
          </span>
        </header>

        {/* Main Pre-Join Lobby Content */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: 16:9 Camera & Microphone Preview Box */}
          <div className="lg:col-span-7 bg-[#202124] rounded-2xl aspect-video relative overflow-hidden flex items-center justify-center shadow-xl">
            {!isCameraOff ? (
              <video
                ref={bindLobbyVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center space-y-3">
                <div className="w-20 h-20 rounded-full bg-[#0b57d0] text-white text-2xl font-semibold flex items-center justify-center mx-auto shadow-md">
                  {(displayName.trim() || "P").charAt(0).toUpperCase()}
                </div>
                <p className="text-sm text-[#e3e3e3]">A câmera está desligada</p>
              </div>
            )}

            {/* Bottom Floating Mic & Camera Controls inside Preview */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleToggleMic}
                aria-label={isMuted ? "Ativar microfone" : "Desativar microfone"}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer shadow-lg ${
                  isMuted
                    ? "bg-[#ea4335] text-white hover:bg-[#d93025]"
                    : "bg-[#3c4043]/90 text-white hover:bg-[#4e5256]"
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
                    ? "bg-[#ea4335] text-white hover:bg-[#d93025]"
                    : "bg-[#3c4043]/90 text-white hover:bg-[#4e5256]"
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

          {/* Right: "Pronto para participar?" Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setInPreJoinLobby(false);
            }}
            className="lg:col-span-5 flex flex-col items-center lg:items-start text-center lg:text-left space-y-5"
          >
            <div>
              <h1 className="text-2xl sm:text-3xl font-normal text-[#1f1f1f]">
                Pronto para participar?
              </h1>
              <p className="text-sm text-[#5f6368] mt-1">
                Você está entrando na reunião <code className="font-mono font-semibold text-[#1f1f1f]">{roomCode}</code>
              </p>
            </div>

            <div className="w-full max-w-sm">
              <label className="block text-xs font-medium text-[#5f6368] mb-1.5">
                Qual é o seu nome?
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Digite seu nome para entrar na sala"
                autoFocus
                className="w-full border border-[#dadce0] focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 rounded-xl px-4 py-3 text-sm text-[#1f1f1f] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                className="h-12 px-8 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-semibold shadow-md transition-colors cursor-pointer"
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
      <div className="min-h-screen bg-[#131314] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#1e1f20] border border-[#3c4043] rounded-3xl p-8 text-center space-y-5 shadow-2xl">
          <h1 className="text-2xl font-normal">Você saiu da reunião</h1>
          <p className="text-sm text-[#c4c7c5]">
            Sala <code className="text-white font-mono">{roomCode}</code> •
            Duração:{" "}
            <strong className="text-white">
              {formatUnlimitedDuration(elapsedSeconds)}
            </strong>
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCallEnded(false)}
              className="px-5 py-2.5 rounded-full border border-[#8e918f] hover:bg-[#282a2c] text-sm font-medium cursor-pointer"
            >
              Voltar para a sala
            </button>
            <button
              type="button"
              onClick={handleExportMarkdownMinutes}
              className="px-5 py-2.5 rounded-full bg-[#004a77] hover:bg-[#00639b] text-[#c2e7ff] text-sm font-medium flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              Baixar resumo da reunião
            </button>
            <button
              type="button"
              onClick={navigateBackHome}
              className="px-6 py-2.5 rounded-full bg-[#a8c7fa] hover:bg-[#8ab4f8] text-[#041e49] text-sm font-semibold cursor-pointer"
            >
              Voltar à tela inicial
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // SCREEN 3: ACTIVE MEETING ROOM
  // ============================================================================
  return (
    <div
      className={`h-screen w-screen flex flex-col justify-between overflow-hidden select-none ${
        highContrastMode ? "bg-black text-white" : "bg-[#131314] text-white"
      }`}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {a11yLiveText}
      </div>

      {statusToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#282a2c] border border-[#8ab4f8]/50 text-white px-5 py-2 rounded-full text-xs font-medium shadow-2xl flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#81c995]" />
          <span>{statusToast}</span>
        </div>
      )}

      {/* TOP BAR */}
      <header className="h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[#e3e3e3]">
            {clockText}
          </span>
          <span className="text-[#5f6368]">|</span>
          <span className="text-sm font-medium text-[#e3e3e3] tracking-wide">
            {roomCode}
          </span>
          <button
            type="button"
            onClick={() => setShowReadyCard((v) => !v)}
            title="Detalhes e link da reunião"
            aria-label="Exibir ou ocultar cartão de detalhes da sala"
            className="p-1.5 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] cursor-pointer"
          >
            <Info className="w-4 h-4" />
          </button>

          {/* Active Recording Pill */}
          {recordingSession && (
            <div className="flex items-center gap-2 bg-[#3c1917] border border-[#f28b82]/50 text-[#f28b82] rounded-full px-3.5 py-1 text-xs font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#ea4335]" />
              <span>
                {recordingSession.state === "PAUSED" ? "Pausado" : "Gravando"}{" "}
                {formatUnlimitedDuration(activeRecDurationSec)}
              </span>
              <button
                type="button"
                onClick={handlePauseResumeRecording}
                title={
                  recordingSession.state === "PAUSED" ? "Retomar" : "Pausar"
                }
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
                title="Parar gravação"
                className="p-0.5 hover:text-white cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            </div>
          )}
        </div>

        {/* Right Top Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setHighContrastMode((v) => !v);
              showToast(
                !highContrastMode
                  ? "Alto contraste ativado"
                  : "Alto contraste desativado",
              );
            }}
            title="Alternar Modo Alto Contraste"
            aria-label="Alternar Alto Contraste"
            className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${
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
            className="w-8 h-8 rounded-full bg-[#282a2c] hover:bg-[#3c4043] flex items-center justify-center text-[#c4c7c5] cursor-pointer"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "people" ? null : "people"))
            }
            aria-label={`Participantes na sala: ${participants.length}`}
            className="flex items-center gap-2 bg-[#282a2c] hover:bg-[#3c4043] rounded-full px-3 py-1.5 cursor-pointer"
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
            className="w-8 h-8 rounded-full bg-[#282a2c] hover:bg-[#3c4043] flex items-center justify-center text-[#c4c7c5] cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN VIDEO STAGE + FLOATING CARDS + SIDE DRAWER */}
      <div className="flex-1 px-4 py-1 flex gap-3 overflow-hidden relative">
        {/* Dedicated Screen Share Stage when presenting */}
        {isScreenSharing && (
          <div className="flex-1 bg-[#0d1520] border-2 border-[#a8c7fa]/40 rounded-2xl relative flex flex-col overflow-hidden">
            <div className="bg-[#1e1f20]/90 px-4 py-2 flex items-center justify-between border-b border-[#3c4043]">
              <span className="text-xs font-medium text-[#a8c7fa] flex items-center gap-2">
                <MonitorUp className="w-4 h-4" />
                Você está apresentando sua tela para todos
              </span>
              <button
                type="button"
                onClick={handleToggleScreenShare}
                className="px-3 py-1 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white text-xs font-semibold cursor-pointer"
              >
                Parar apresentação
              </button>
            </div>
            <video
              ref={bindScreenVideoRef}
              autoPlay
              playsInline
              muted
              className="flex-1 w-full h-full object-contain bg-black"
            />
          </div>
        )}

        {/* Participant Video Stage Grid */}
        <div
          className={`${
            isScreenSharing ? "w-72 shrink-0 flex flex-col" : "flex-1 grid"
          } gap-3 h-full ${
            !isScreenSharing &&
            (layoutMode === "spotlight" || participants.length === 1
              ? "grid-cols-1"
              : participants.length === 2
                ? "grid-cols-1 md:grid-cols-2"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")
          }`}
        >
          {(layoutMode === "spotlight" ? [participants[0]] : participants).map(
            (participant) => {
              const hasRemoteVideo =
                !participant.isLocal &&
                !participant.isCameraOff &&
                !!participant.stream &&
                participant.stream
                  .getVideoTracks()
                  .some((t) => t.readyState === "live");

              return (
                <div
                  key={participant.id}
                  className={`rounded-2xl relative flex items-center justify-center overflow-hidden shadow-inner group flex-1 ${
                    highContrastMode
                      ? "bg-[#0a192f] border-2 border-yellow-400"
                      : "bg-[#1b3a6b] border border-white/10"
                  }`}
                >
                  {/* Top-Right Mic Status / Equalizer Badge */}
                  <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-1.5">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center ${
                        participant.isMuted
                          ? "bg-[#172b4d]/80 text-[#8ab4f8]"
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
                    <div className="absolute top-3.5 left-3.5 z-10 bg-[#fbbc04] text-[#1f1f1f] px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-md">
                      <Hand className="w-3.5 h-3.5" />
                      Mão levantada
                    </div>
                  )}

                  {/* Remote Audio + Video Renderer */}
                  {!participant.isLocal && (
                    <RemoteParticipantMedia
                      stream={participant.stream}
                      isCameraOff={participant.isCameraOff}
                      isMuted={participant.isMuted}
                    />
                  )}

                  {/* Local Camera Video or Centered Avatar */}
                  {participant.isLocal && !isCameraOff ? (
                    <video
                      ref={bindLocalVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : !hasRemoteVideo ? (
                    <div className="relative flex items-center justify-center">
                      <div
                        style={{ backgroundColor: participant.avatarColor }}
                        className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-semibold text-white shadow-lg transition-transform ${
                          !participant.isMuted
                            ? "ring-4 ring-[#8ab4f8]/70 scale-105"
                            : ""
                        }`}
                      >
                        {participant.name.charAt(0).toUpperCase()}
                      </div>

                      {/* Center Hover Action Pill across Avatar */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-[#202124]/75 hover:bg-[#202124]/95 backdrop-blur-xs text-[#e3e3e3] rounded-full px-3 py-1.5 flex items-center gap-3 shadow-md transition-opacity">
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
                            aria-label="Alternar tela cheia"
                            className="hover:text-white cursor-pointer"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLayoutMode((m) =>
                                m === "spotlight" ? "auto" : "spotlight"
                              );
                              showToast(
                                layoutMode === "spotlight"
                                  ? "Layout em grade restaurado"
                                  : `${participant.name} fixado na tela principal`
                              );
                            }}
                            title="Fixar em destaque"
                            aria-label="Fixar participante na tela principal"
                            className="hover:text-white cursor-pointer"
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowMoreMenu((v) => !v)}
                            title="Mais opções"
                            aria-label="Mais opções do participante"
                            className="hover:text-white cursor-pointer"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Bottom-left Participant Nameplate */}
                  <div className="absolute bottom-3 left-3.5 bg-black/60 backdrop-blur-xs px-3 py-1 rounded-full text-xs font-medium text-white flex items-center gap-2">
                    <span>{participant.name}</span>
                    <span className="text-[10px] text-[#a8c7fa]">
                      •{" "}
                      {participant.role === "HOST"
                        ? "Organizador"
                        : "Participante"}
                    </span>
                  </div>
                </div>
              );
            }
          )}
        </div>

        {/* FLOATING OVERLAY: "Sua reunião está pronta" (Shown ONLY to the Host/Creator or when (i) is clicked) */}
        {showReadyCard && (
          <div className="absolute bottom-3 left-6 z-30 w-[330px] flex flex-col">
            <div className="bg-white text-[#1f1f1f] rounded-2xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-3.5">
                <h2 className="text-base font-medium text-[#1f1f1f]">
                  Sua reunião está pronta
                </h2>
                <button
                  type="button"
                  onClick={() => setShowReadyCard(false)}
                  aria-label="Fechar cartão de convite"
                  className="p-1 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopyRoomLink}
                className="bg-[#0b57d0] hover:bg-[#0842a0] text-white rounded-full px-4 py-2.5 text-xs font-medium inline-flex items-center gap-2 mb-3.5 cursor-pointer shadow-xs"
              >
                <UserPlus className="w-4 h-4" />
                <span>Copiar convite para outras pessoas</span>
              </button>

              <p className="text-xs text-[#444746] leading-relaxed mb-2.5">
                Ou compartilhe este link da reunião com quem você quer que
                participe
              </p>

              <div className="bg-[#f1f3f4] rounded-lg px-3 py-2.5 flex items-center justify-between gap-2">
                <span className="text-xs text-[#1f1f1f] truncate font-mono">
                  {realShareableLink}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRoomLink}
                  title="Copiar link da reunião"
                  aria-label="Copiar link da reunião"
                  className="text-[#444746] hover:text-[#1f1f1f] cursor-pointer shrink-0"
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
              <div className="bg-[#004a77] text-white rounded-2xl p-4 shadow-2xl -mt-3 mx-1 relative border border-[#00639b]">
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
              className="absolute bottom-16 flex flex-col items-center animate-reaction-float"
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
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-2xl w-full px-4">
            <div className="bg-black/85 backdrop-blur-xs border border-white/15 rounded-2xl px-5 py-3 text-sm text-white shadow-xl flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] text-[#8ab4f8] font-semibold mb-0.5">
                  {captions[captions.length - 1].speakerName} • Legendas ao Vivo
                </div>
                <div>{captions[captions.length - 1].text}</div>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT SIDE DRAWER */}
        {activeDrawer && (
          <aside className="w-80 sm:w-96 bg-[#1e1f20] border border-[#3c4043] rounded-2xl flex flex-col overflow-hidden shrink-0 z-30">
            <div className="px-5 py-4 border-b border-[#3c4043] flex items-center justify-between">
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
                aria-label="Fechar painel lateral"
                className="p-1 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {activeDrawer === "people" && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyRoomLink}
                    className="w-full py-2.5 px-4 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    Copiar link para convidar pessoas
                  </button>
                  <div className="space-y-2 pt-2">
                    {participants.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-[#282a2c]"
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            style={{ backgroundColor: p.avatarColor }}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
                          >
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-white">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-[#9aa0a6]">
                              {p.role === "HOST"
                                ? "Organizador da reunião"
                                : "Participante"}
                            </div>
                          </div>
                        </div>
                        {p.isMuted ? (
                          <MicOff className="w-4 h-4 text-[#f28b82]" />
                        ) : (
                          <Mic className="w-4 h-4 text-[#81c995]" />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {activeDrawer === "chat" && (
                <div className="flex flex-col h-full justify-between space-y-3">
                  <div className="space-y-2.5 overflow-y-auto pr-1">
                    {chatMessages.map((m) => (
                      <div key={m.id} className="bg-[#282a2c] rounded-xl p-3">
                        <div className="flex items-center justify-between text-[11px] text-[#9aa0a6] mb-1">
                          <span className="font-semibold text-white">
                            {m.senderName}
                          </span>
                          <span>{m.timestamp}</span>
                        </div>
                        <p className="text-[#e3e3e3] leading-relaxed">
                          {m.text}
                        </p>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleSendChat} className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={chatDraft}
                      onChange={(e) => setChatDraft(e.target.value)}
                      placeholder="Enviar mensagem para todos..."
                      className="flex-1 bg-[#282a2c] border border-[#3c4043] rounded-full px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#a8c7fa]"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-full bg-[#0b57d0] text-white font-medium cursor-pointer"
                    >
                      Enviar
                    </button>
                  </form>
                </div>
              )}

              {activeDrawer === "ai" && (
                <div className="space-y-3">
                  <div className="bg-[#004a77]/60 border border-[#00639b] rounded-xl p-3 text-[#c2e7ff]">
                    Faça perguntas ao Assistente IA sobre a discussão ou gere a
                    ata completa.
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleSendAiPrompt(
                          undefined,
                          "Resuma a discussão até agora",
                        )
                      }
                      className="bg-[#282a2c] hover:bg-[#3c4043] text-[#a8c7fa] px-3 py-1.5 rounded-full text-[11px] cursor-pointer"
                    >
                      ✦ Resumir discussão
                    </button>
                    <button
                      type="button"
                      onClick={handleExportMarkdownMinutes}
                      className="bg-[#1e3a2f] hover:bg-[#274d3e] text-[#81c995] px-3 py-1.5 rounded-full text-[11px] cursor-pointer"
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
                  <div className="bg-[#282a2c] border border-[#3c4043] rounded-xl p-3.5 space-y-2">
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <Disc className="w-4 h-4 text-[#ea4335]" />
                      Gravação da reunião
                    </div>
                    <p className="text-[11px] text-[#c4c7c5]">
                      Grave a reunião para assistir ou compartilhar depois.
                    </p>
                    {!recordingSession ? (
                      <button
                        type="button"
                        onClick={handleStartUnlimitedRecording}
                        className="w-full py-2 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white font-semibold cursor-pointer"
                      >
                        ● Iniciar gravação
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopAndDownloadRecording}
                        className="w-full py-2 rounded-full bg-[#f28b82] text-[#601410] font-semibold cursor-pointer"
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
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <video
                        src={previewVideoUrl}
                        controls
                        className="w-full rounded-lg bg-black max-h-40"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleExportMarkdownMinutes}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#282a2c] hover:bg-[#3c4043] text-white font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#a8c7fa]" />
                    Exportar resumo e transcrição
                  </button>

                  <div className="pt-2">
                    <div className="font-semibold text-[#9aa0a6] uppercase tracking-wider text-[10px] mb-2">
                      Gravações recentes ({savedRecordings.length})
                    </div>
                    {savedRecordings.map((rec) => (
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
                              const blob = await assembleRecordingBlobFromVault(
                                rec.sessionId,
                                rec.mimeType,
                              );
                              if (blob) {
                                const url = URL.createObjectURL(blob);
                                setPreviewVideoUrl(url);
                              }
                            }}
                            className="p-2 rounded-full bg-[#1e3a2f] text-[#81c995] cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Baixar gravação"
                            onClick={async () => {
                              const blob = await assembleRecordingBlobFromVault(
                                rec.sessionId,
                                rec.mimeType,
                              );
                              if (blob) {
                                triggerBlobDownload(
                                  blob,
                                  `freeting-${rec.roomCode}-${rec.sessionId}.webm`,
                                );
                              }
                            }}
                            className="p-2 rounded-full bg-[#0b57d0] text-white cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeDrawer === "security" && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-[#282a2c] flex items-center justify-between">
                    <div>
                      <div className="font-medium text-white">
                        Bloquear entrada na sala
                      </div>
                      <div className="text-[11px] text-[#9aa0a6]">
                        Exigir aprovação do organizador
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isRoomLocked}
                      onChange={(e) => {
                        setIsRoomLocked(e.target.checked);
                        showToast(
                          e.target.checked
                            ? "Sala bloqueada para novos visitantes"
                            : "Sala desbloqueada",
                        );
                      }}
                      className="w-4 h-4 accent-[#a8c7fa]"
                    />
                  </div>
                  <div className="p-3 rounded-xl bg-[#282a2c] flex items-center justify-between">
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
                            : "Mascaramento automático LGPD desativado",
                        );
                      }}
                      className="w-4 h-4 accent-[#a8c7fa]"
                    />
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* BOTTOM CONTROL BAR */}
      <footer className="h-20 px-5 flex items-center justify-between gap-4 shrink-0 relative">
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

        {/* Center Media Controls */}
        <div
          role="toolbar"
          aria-label="Controles de mídia e gravação da reunião"
          className="flex items-center gap-2 mx-auto"
        >
          {/* 1. Split Microphone Pill */}
          <div className="relative flex items-center bg-[#282a2c] rounded-full h-11 p-1 border border-[#3c4043]/60">
            <button
              type="button"
              onClick={handleToggleMic}
              title="Opções de microfone (Alt+M)"
              aria-label="Opções de microfone"
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
                  ? "bg-[#3c4043] text-white hover:bg-[#4e5256]"
                  : "bg-[#0b57d0] text-white"
              }`}
            >
              {isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
            {isMuted && (
              <span className="absolute -top-1 -right-0.5 w-4 h-4 rounded-full bg-[#fbbc04] text-[#1f1f1f] text-[10px] font-bold flex items-center justify-center">
                !
              </span>
            )}
          </div>

          {/* 2. Split Camera Pill */}
          <div className="relative flex items-center bg-[#282a2c] rounded-full h-11 p-1 border border-[#3c4043]/60">
            <button
              type="button"
              onClick={handleToggleCamera}
              title="Opções de câmera (Alt+V)"
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
                  ? "bg-[#3c4043] text-white hover:bg-[#4e5256]"
                  : "bg-[#0b57d0] text-white"
              }`}
            >
              {isCameraOff ? (
                <VideoOff className="w-4 h-4" />
              ) : (
                <Video className="w-4 h-4" />
              )}
            </button>
            {isCameraOff && (
              <span className="absolute -top-1 -right-0.5 w-4 h-4 rounded-full bg-[#fbbc04] text-[#1f1f1f] text-[10px] font-bold flex items-center justify-center">
                !
              </span>
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

          {/* 4. Recorder Button ("Gravar") */}
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
            onClick={() => {
              const next = !isHandRaised;
              setIsHandRaised(next);
              showToast(next ? "✋ Mão levantada" : "Mão abaixada");
              webrtcEngineRef.current?.updateLocalParticipantMeta({
                isHandRaised: next,
              });
              setParticipants((prev) =>
                prev.map((p) => (p.isLocal ? { ...p, isHandRaised: next } : p)),
              );
            }}
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

          {/* 8. More Options (⋮) */}
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
                {
                  key: "Alt + R",
                  action: "Iniciar / Parar Gravação",
                },
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
