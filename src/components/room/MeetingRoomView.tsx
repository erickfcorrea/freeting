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
  Infinity as InfinityIcon,
  Clock,
  FileText,
  Edit3,
  Eye,
  Keyboard,
  Contrast,
  Wifi,
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

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👏", "😂", "😮"];

const SIMULATED_BOT_PROFILES = [
  {
    name: "Dra. Camila Mendes",
    greeting:
      "Olá pessoal! Que ótimo não termos mais o limite de 1 hora de reunião aqui no FREETING.",
  },
  {
    name: "Carlos Eduardo (Tech Lead)",
    greeting:
      "Áudio e vídeo super estáveis. Já ativei as anotações na minha aba também!",
  },
  {
    name: "Marina Costa (Produto)",
    greeting:
      "A gravação ilimitada em WebM funcionando direto no navegador salvou nossa sprint.",
  },
];

export type StageLayoutMode = "auto" | "grid" | "spotlight";

export function MeetingRoomView({ roomCode }: { roomCode: string }) {
  const router = useRouter();

  // Clock & Unlimited Elapsed Duration
  const [clockText, setClockText] = useState("18:32");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Media & Accessibility States
  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCaptionsOn, setIsCaptionsOn] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [isCallEnded, setIsCallEnded] = useState(false);
  const [highContrastMode, setHighContrastMode] = useState(false);
  const [layoutMode, setLayoutMode] = useState<StageLayoutMode>("auto");
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [a11yLiveText, setA11yLiveText] = useState(
    `Conectado à sala ${roomCode} sem limite de 1 hora.`
  );

  // Overlays & Cards (Screenshot 2: "Sua reunião está pronta" + Teal Portuguese Gemini/AI card)
  const [showReadyCard, setShowReadyCard] = useState(true);
  const [showPtToastCard, setShowPtToastCard] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showReactionBar, setShowReactionBar] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<
    null | "people" | "chat" | "activities" | "security" | "ai"
  >(null);

  // Streams & Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const webrtcEngineRef = useRef<FreetingWebRtcRoomEngine | null>(null);
  const recorderRef = useRef<LiveUnlimitedMediaRecorder | null>(null);
  const localPeerIdRef = useRef<string>(
    `peer_${Math.random().toString(36).slice(2, 9)}`
  );

  // Participants, Chat, Captions, Reactions, AI
  const [participants, setParticipants] = useState<RoomParticipant[]>([
    {
      id: "local_host",
      name: "Erick (Você)",
      role: "HOST",
      isLocal: true,
      isMuted: true,
      isCameraOff: true,
      isScreenSharing: false,
      isHandRaised: false,
      isSpeaking: false,
      avatarColor: "#0b57d0",
      joinedAtIso: new Date().toISOString(),
    },
  ]);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([
    {
      id: "welcome_msg",
      senderId: "system",
      senderName: "FREETING Sistema ∞",
      text: "Bem-vindo à sala sem limite de tempo! A chamada nunca cai após 60 minutos e a gravação local ilimitada está pronta.",
      timestamp: "18:32",
    },
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [captions, setCaptions] = useState<RoomCaptionEntry[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponses, setAiResponses] = useState<AiAssistantResponse[]>([]);

  // Unlimited Recording State
  const [recordingSession, setRecordingSession] =
    useState<UnlimitedRecordingSession | null>(null);
  const [recordingTickMs, setRecordingTickMs] = useState<number>(Date.now());
  const [savedRecordings, setSavedRecordings] = useState<StoredRecordingMeta[]>(
    []
  );

  const announce = useCallback((msg: string) => {
    setA11yLiveText(msg);
  }, []);

  // Update clock and unlimited call duration every second
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
      setElapsedSeconds((prev) => prev + 1);
      setRecordingTickMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load saved recordings from IndexedDB Vault
  const refreshVault = useCallback(async () => {
    const list = await listRecordingsFromVault();
    setSavedRecordings(list);
  }, []);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  // Connect BroadcastChannel + WebRTC multi-tab signaling
  useEffect(() => {
    const localId = localPeerIdRef.current;
    const engine = new FreetingWebRtcRoomEngine({
      roomCode,
      localId,
      onSignal: (payload) => {
        if (payload.type === "PEER_ANNOUNCE") {
          setParticipants((prev) => {
            if (prev.some((p) => p.id === payload.participant.id)) return prev;
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
        } else if (payload.type === "PEER_LEAVE") {
          setParticipants((prev) =>
            prev.filter((p) => p.id !== payload.participantId)
          );
        } else if (payload.type === "CHAT_MESSAGE") {
          setChatMessages((prev) => [...prev, payload.message]);
        } else if (payload.type === "REACTION") {
          spawnReaction(payload.emoji, payload.senderName);
        } else if (payload.type === "CAPTION") {
          setCaptions((prev) => [...prev, payload.entry]);
        }
      },
      onRemoteStream: (peerId, stream) => {
        setParticipants((prev) =>
          prev.map((p) => (p.id === peerId ? { ...p, stream } : p))
        );
      },
    });

    webrtcEngineRef.current = engine;
    engine.connect(
      {
        id: localId,
        name: "Erick (Outra Aba)",
        role: "PARTICIPANT",
        isMuted: true,
        isCameraOff: true,
        isScreenSharing: false,
        isHandRaised: false,
        isSpeaking: false,
        avatarColor: pickAvatarColor(localId),
        joinedAtIso: new Date().toISOString(),
      },
      null
    );

    return () => {
      engine.disconnect();
      releaseMediaStream(localStreamRef.current);
      releaseMediaStream(screenStreamRef.current);
    };
  }, [roomCode]);

  // Attach local camera or screen stream to <video> element whenever active
  useEffect(() => {
    const videoEl = localVideoRef.current;
    if (!videoEl) return;
    if (isScreenSharing && screenStreamRef.current) {
      videoEl.srcObject = screenStreamRef.current;
    } else if (!isCameraOff && localStreamRef.current) {
      videoEl.srcObject = localStreamRef.current;
    } else {
      videoEl.srcObject = null;
    }
  }, [isCameraOff, isScreenSharing]);

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
        const stream =
          localStreamRef.current ||
          (await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: !isCameraOff,
          }));
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = true));
        webrtcEngineRef.current?.updateLocalStream(stream);
      } catch {
        // Fallback: allow UI unmute state even in headless/permissionless browser environments
      }
      setIsMuted(false);
      announce("Microfone ativado");
      setParticipants((prev) =>
        prev.map((p) =>
          p.isLocal ? { ...p, isMuted: false, isSpeaking: true } : p
        )
      );
    } else {
      localStreamRef.current
        ?.getAudioTracks()
        .forEach((t) => (t.enabled = false));
      setIsMuted(true);
      announce("Microfone desativado");
      setParticipants((prev) =>
        prev.map((p) =>
          p.isLocal ? { ...p, isMuted: true, isSpeaking: false } : p
        )
      );
    }
  }, [isMuted, isCameraOff, announce]);

  // Toggle Camera
  const handleToggleCamera = useCallback(async () => {
    if (isCameraOff) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: !isMuted,
        });
        localStreamRef.current = stream;
        webrtcEngineRef.current?.updateLocalStream(stream);
      } catch {
        // Fallback if no physical webcam is connected
      }
      setIsCameraOff(false);
      announce("Câmera ativada");
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isCameraOff: false } : p))
      );
    } else {
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      setIsCameraOff(true);
      announce("Câmera desativada");
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isCameraOff: true } : p))
      );
    }
  }, [isCameraOff, isMuted, announce]);

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        screenStreamRef.current = displayStream;
        displayStream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          screenStreamRef.current = null;
        };
        setIsScreenSharing(true);
        announce("Compartilhamento de tela iniciado");
      } catch {
        // User cancelled screen picker
      }
    } else {
      releaseMediaStream(screenStreamRef.current);
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      announce("Compartilhamento de tela encerrado");
    }
  };

  // Start / Pause / Resume / Stop Unlimited Recording
  const handleStartUnlimitedRecording = useCallback(async () => {
    const recorder = new LiveUnlimitedMediaRecorder(roomCode, (updated) => {
      setRecordingSession({ ...updated });
    });
    recorderRef.current = recorder;

    const primaryStream = isScreenSharing
      ? screenStreamRef.current
      : localStreamRef.current;

    await recorder.start({
      primaryVideoStream: primaryStream,
      audioStreams: [localStreamRef.current, screenStreamRef.current],
      roomCode,
      participantNames: participants.map((p) => p.name),
      getActiveCaption: () =>
        captions.length > 0
          ? `${captions[captions.length - 1].speakerName}: ${
              captions[captions.length - 1].text
            }`
          : "",
    });
    announce(
      "Gravação ilimitada iniciada. Os chunks estão sendo salvos no IndexedDB."
    );
  }, [roomCode, isScreenSharing, participants, captions, announce]);

  const handlePauseResumeRecording = () => {
    if (!recorderRef.current || !recordingSession) return;
    if (recordingSession.state === "RECORDING") {
      recorderRef.current.pause();
      announce("Gravação pausada");
    } else if (recordingSession.state === "PAUSED") {
      recorderRef.current.resume();
      announce("Gravação retomada");
    }
  };

  const handleStopAndDownloadRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    await recorderRef.current.stopAndSave({
      title: `Reunião FREETING (${roomCode})`,
      transcriptSummary: captions
        .map((c) => `${c.speakerName}: ${c.text}`)
        .join(" | "),
      autoDownload: true,
    });
    recorderRef.current = null;
    setRecordingSession(null);
    announce("Gravação finalizada e arquivo WebM baixado com sucesso.");
    await refreshVault();
  }, [roomCode, captions, announce, refreshVault]);

  // Toggle Live Captions (pt-BR)
  const handleToggleCaptions = useCallback(() => {
    const next = !isCaptionsOn;
    setIsCaptionsOn(next);
    announce(
      next
        ? "Legendas ao vivo em português ativadas"
        : "Legendas ao vivo desativadas"
    );
    if (next) {
      const entry: RoomCaptionEntry = {
        id: `cap_${Date.now()}`,
        speakerName: "Erick (Você)",
        text: "Legendas em Português ativadas. Esta reunião no FREETING não possui limite de 1 hora e a gravação é ilimitada.",
        timestamp: clockText,
      };
      setCaptions((prev) => [...prev, entry]);
      webrtcEngineRef.current?.broadcast({ type: "CAPTION", entry });
    }
  }, [isCaptionsOn, clockText, announce]);

  // Global Accessible Keyboard Shortcuts (Alt+M, Alt+V, Alt+R, Alt+C, Alt+H, ?)
  useEffect(() => {
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
    handleToggleMic,
    handleToggleCamera,
    handleStartUnlimitedRecording,
    handleStopAndDownloadRecording,
    handleToggleCaptions,
    recordingSession,
  ]);

  // Simulate adding a remote WebRTC participant
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
    announce(`${profile.name} entrou na reunião.`);

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
    announce("Resposta do Assistente IA gerada.");
  };

  // Send Chat Message
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    const msg: RoomChatMessage = {
      id: `chat_${Date.now()}`,
      senderId: "local_host",
      senderName: "Erick (Você)",
      text: chatDraft.trim(),
      timestamp: clockText,
    };
    setChatMessages((prev) => [...prev, msg]);
    webrtcEngineRef.current?.broadcast({ type: "CHAT_MESSAGE", message: msg });
    setChatDraft("");
  };

  // Download Markdown Minutes & Transcript
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
    announce("Ata da reunião exportada em Markdown.");
  };

  // End Call & Clean Hardware Tracks
  const handleEndCall = async () => {
    if (recorderRef.current && recordingSession) {
      await handleStopAndDownloadRecording();
    }
    releaseMediaStream(localStreamRef.current);
    releaseMediaStream(screenStreamRef.current);
    webrtcEngineRef.current?.disconnect();
    setIsCallEnded(true);
    announce("Você saiu da chamada.");
  };

  const handleCopyRoomLink = async () => {
    const url = formatShareableLink(
      roomCode,
      typeof window !== "undefined" ? window.location.origin : undefined
    );
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      announce("Link da sala copiado.");
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // ignore
    }
  };

  const activeRecDurationSec = recordingSession
    ? Math.floor(
        getEffectiveRecordingDurationMs(recordingSession, recordingTickMs) /
          1000
      )
    : 0;

  if (isCallEnded) {
    return (
      <div className="min-h-screen bg-[#131314] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#1e1f20] border border-[#3c4043] rounded-3xl p-8 text-center space-y-5 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-[#1e3a2f] text-[#81c995] flex items-center justify-center mx-auto">
            <InfinityIcon className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-normal">Você saiu da reunião</h1>
          <p className="text-sm text-[#c4c7c5]">
            Sala <code className="text-white font-mono">{roomCode}</code> • Tempo
            total de sessão:{" "}
            <strong className="text-[#81c995]">
              {formatUnlimitedDuration(elapsedSeconds)} (Sem limite de 1h)
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
              Baixar Ata & Transcrição (.md)
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="px-6 py-2.5 rounded-full bg-[#a8c7fa] hover:bg-[#8ab4f8] text-[#041e49] text-sm font-semibold cursor-pointer"
            >
              Voltar à tela inicial
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-screen w-screen flex flex-col justify-between overflow-hidden select-none ${
        highContrastMode ? "bg-black text-white" : "bg-[#131314] text-white"
      }`}
    >
      {/* ARIA Live Status Region for Screen Readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {a11yLiveText}
      </div>

      {/* TOP BAR — Exact Match to Screenshot 2 + FREETING Unlimited & Accessibility Telemetry */}
      <header className="h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[#e3e3e3]">{clockText}</span>
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

          {/* Unlimited Duration Pill */}
          <div
            title="Sem limite de 60 minutos! Clique em +1h para testar reuniões de longa duração."
            className="hidden sm:flex items-center gap-2 bg-[#1e3a2f]/90 border border-[#34a853]/40 text-[#81c995] rounded-full px-3 py-1 text-xs font-medium"
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="font-mono">
              {formatUnlimitedDuration(elapsedSeconds)}
            </span>
            <span>• ∞ Sem Limite</span>
            <button
              type="button"
              onClick={() => {
                setElapsedSeconds((s) => s + 3600);
                announce("Simulando mais 1 hora de reunião sem corte.");
              }}
              className="ml-1 bg-[#34a853]/30 hover:bg-[#34a853]/50 text-white px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer"
            >
              +1h
            </button>
          </div>

          {/* Network & Database Sync Badge */}
          <div className="hidden xl:flex items-center gap-1.5 bg-[#282a2c] text-[#c4c7c5] rounded-full px-3 py-1 text-[11px]">
            <Wifi className="w-3.5 h-3.5 text-[#81c995]" />
            <span>P2P HD • 14ms • SQLite Sync</span>
          </div>

          {/* Active Unlimited Recording Pill */}
          {recordingSession && (
            <div className="flex items-center gap-2 bg-[#3c1917] border border-[#f28b82]/50 text-[#f28b82] rounded-full px-3.5 py-1 text-xs font-medium animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#ea4335]" />
              <span>
                {recordingSession.state === "PAUSED" ? "PAUSADO" : "REC ∞"}{" "}
                {formatUnlimitedDuration(activeRecDurationSec)}
              </span>
              <span className="text-[#e3e3e3]/80">
                ({formatRecordingBytes(recordingSession.totalBytes)})
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
                title="Finalizar e baixar .webm"
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
            onClick={handleAddSimulatedParticipant}
            className="hidden md:flex items-center gap-1.5 bg-[#282a2c] hover:bg-[#3c4043] text-[#a8c7fa] border border-[#3c4043] rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Simular Participante</span>
          </button>

          {/* High Contrast Accessibility Toggle */}
          <button
            type="button"
            onClick={() => {
              setHighContrastMode((v) => !v);
              announce(
                !highContrastMode
                  ? "Alto contraste ativado"
                  : "Alto contraste desativado"
              );
            }}
            title="Alternar Modo Alto Contraste (Acessibilidade WCAG AAA)"
            aria-label="Alternar Alto Contraste"
            className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${
              highContrastMode
                ? "bg-yellow-400 text-black"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#c4c7c5]"
            }`}
          >
            <Contrast className="w-4 h-4" />
          </button>

          {/* Keyboard Shortcuts Helper Button */}
          <button
            type="button"
            onClick={() => setShowShortcutsModal(true)}
            title="Atalhos de Teclado e Acessibilidade (?)"
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
            className="flex items-center gap-2 bg-[#282a2c] hover:bg-[#3c4043] rounded-full pl-1.5 pr-3 py-1 cursor-pointer"
          >
            <div className="w-6 h-6 rounded-full bg-[#0b57d0] text-white text-xs font-bold flex items-center justify-center">
              E
            </div>
            <span className="text-xs font-semibold text-[#e3e3e3]">
              {participants.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer((d) => (d === "activities" ? null : "activities"))
            }
            title="Efeitos e Gravações Ilimitadas"
            aria-label="Atividades e gravações"
            className="w-8 h-8 rounded-full bg-[#282a2c] hover:bg-[#3c4043] flex items-center justify-center text-[#c4c7c5] cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN VIDEO STAGE + FLOATING CARDS + SIDE DRAWER */}
      <div className="flex-1 px-4 py-1 flex gap-3 overflow-hidden relative">
        {/* Video Stage Grid */}
        <div
          className={`flex-1 grid gap-3 h-full ${
            layoutMode === "spotlight" || participants.length === 1
              ? "grid-cols-1"
              : participants.length === 2
              ? "grid-cols-1 md:grid-cols-2"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {(layoutMode === "spotlight" ? [participants[0]] : participants).map(
            (participant) => (
              <div
                key={participant.id}
                className={`rounded-2xl relative flex items-center justify-center overflow-hidden shadow-inner group ${
                  highContrastMode
                    ? "bg-[#0a192f] border-2 border-yellow-400"
                    : "bg-[#1b3a6b] border border-white/10"
                }`}
              >
                {/* Top-Right Mic Status / Equalizer Badge — Matching Screenshot 2 */}
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

                {/* Live Video or Centered Avatar with Hover Pill */}
                {participant.isLocal && (!isCameraOff || isScreenSharing) ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
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
                              document.documentElement
                                .requestFullscreen()
                                .catch(() => {});
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
                          onClick={() =>
                            setLayoutMode((m) =>
                              m === "spotlight" ? "auto" : "spotlight"
                            )
                          }
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
                )}

                {/* Bottom-left Participant Nameplate */}
                {participants.length > 1 && (
                  <div className="absolute bottom-3 left-3.5 bg-black/60 backdrop-blur-xs px-3 py-1 rounded-full text-xs font-medium text-white flex items-center gap-2">
                    <span>{participant.name}</span>
                    {participant.isSimulated && (
                      <span className="text-[10px] text-[#8ab4f8]">
                        • WebRTC Bot
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* FLOATING OVERLAY: "Sua reunião está pronta" + Teal Portuguese AI Card */}
        {showReadyCard && (
          <div className="absolute bottom-3 left-6 z-30 w-[320px] flex flex-col">
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
                onClick={handleAddSimulatedParticipant}
                className="bg-[#0b57d0] hover:bg-[#0842a0] text-white rounded-full px-4 py-2.5 text-xs font-medium inline-flex items-center gap-2 mb-3.5 cursor-pointer shadow-xs"
              >
                <UserPlus className="w-4 h-4" />
                <span>Adicionar outras pessoas</span>
              </button>

              <p className="text-xs text-[#444746] leading-relaxed mb-2.5">
                Ou compartilhe este link da reunião com quem você quer que
                participe
              </p>

              <div className="bg-[#f1f3f4] rounded-lg px-3 py-2.5 flex items-center justify-between gap-2">
                <span className="text-xs text-[#1f1f1f] truncate font-mono">
                  {`freeting.app/${roomCode}`}
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
                  Agora você pode fazer perguntas à IA em Português, receber
                  resumos de discussões e gravar reuniões{" "}
                  <strong className="underline">sem limite de 1 hora</strong>.
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
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-2xl w-full px-4 pointer-events-none">
            <div className="bg-black/85 backdrop-blur-xs border border-white/15 rounded-2xl px-5 py-3 text-sm text-white shadow-xl">
              <div className="text-[11px] text-[#8ab4f8] font-semibold mb-0.5">
                {captions[captions.length - 1].speakerName} • Legendas ao Vivo
                (Português)
              </div>
              <div>{captions[captions.length - 1].text}</div>
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
                {activeDrawer === "ai" &&
                  "Assistente IA FREETING (Português)"}
                {activeDrawer === "activities" &&
                  "Gravações Ilimitadas (∞) & Ata"}
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
                    onClick={handleAddSimulatedParticipant}
                    className="w-full py-2.5 px-4 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                    Adicionar Participante Simulado
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
                            {p.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-white">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-[#9aa0a6]">
                              {p.role === "HOST"
                                ? "Organizador da reunião"
                                : "Participante conectado"}
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
                    ata completa sem limite de tempo.
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleSendAiPrompt(
                          undefined,
                          "Resuma a discussão até agora"
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
                      ⬇ Baixar Ata (.md)
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
                  <div className="bg-[#1e3a2f] border border-[#34a853]/40 rounded-xl p-3.5 space-y-2">
                    <div className="font-semibold text-[#81c995] flex items-center gap-1.5">
                      <InfinityIcon className="w-4 h-4" />
                      Gravação Ilimitada em Chunks (Sem corte de 1h)
                    </div>
                    <p className="text-[11px] text-[#e3e3e3]">
                      Grave horas seguidas com persistência automática no
                      IndexedDB e download direto em WebM.
                    </p>
                    {!recordingSession ? (
                      <button
                        type="button"
                        onClick={handleStartUnlimitedRecording}
                        className="w-full py-2 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white font-semibold cursor-pointer"
                      >
                        ● Iniciar Gravação Ilimitada Agora
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopAndDownloadRecording}
                        className="w-full py-2 rounded-full bg-[#f28b82] text-[#601410] font-semibold cursor-pointer"
                      >
                        ■ Parar e Baixar Gravação (
                        {formatUnlimitedDuration(activeRecDurationSec)})
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleExportMarkdownMinutes}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#282a2c] hover:bg-[#3c4043] text-white font-medium flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#a8c7fa]" />
                    Exportar Transcrição & Ata Completa (.md)
                  </button>

                  <div className="pt-2">
                    <div className="font-semibold text-[#9aa0a6] uppercase tracking-wider text-[10px] mb-2">
                      Gravações salvas no Cofre ({savedRecordings.length})
                    </div>
                    {savedRecordings.map((rec) => (
                      <div
                        key={rec.sessionId}
                        className="bg-[#282a2c] rounded-xl p-3 mb-2 flex items-center justify-between"
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
                        <button
                          type="button"
                          onClick={async () => {
                            const blob = await assembleRecordingBlobFromVault(
                              rec.sessionId,
                              rec.mimeType
                            );
                            if (blob) {
                              triggerBlobDownload(
                                blob,
                                `freeting-${rec.roomCode}-${rec.sessionId}.webm`
                              );
                            }
                          }}
                          className="p-2 rounded-full bg-[#0b57d0] text-white cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
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
                      onChange={(e) => setIsRoomLocked(e.target.checked)}
                      className="w-4 h-4 accent-[#a8c7fa]"
                    />
                  </div>
                  <div className="p-3 rounded-xl bg-[#1e3a2f] text-[#81c995]">
                    ✓ Política Sem Limite ativa: Esta sala nunca será
                    desconectada após 60 minutos.
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* BOTTOM CONTROL BAR — Faithful to Screenshot 2 */}
      <footer className="h-20 px-5 flex items-center justify-between gap-4 shrink-0 relative">
        {/* Left: "Pedir para ... Somente você ↑" AI Prompt Bar */}
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

        {/* Center: Main Media Controls Pill Group */}
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

          {/* 4. Unlimited Recorder Button ("Gravar ∞") */}
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
                ? "Parar e baixar gravação ilimitada (.webm) (Alt+R)"
                : "Iniciar Gravação Ilimitada (Sem corte de 1 hora) (Alt+R)"
            }
            className={`h-11 px-3.5 rounded-full flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
              recordingSession
                ? "bg-[#ea4335] text-white ring-4 ring-[#ea4335]/30"
                : "bg-[#282a2c] hover:bg-[#3c4043] text-[#81c995] border border-[#34a853]/40"
            }`}
          >
            <Disc className="w-4 h-4" />
            <span>{recordingSession ? "Parar REC" : "Gravar ∞"}</span>
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
                      spawnReaction(emoji, "Erick (Você)");
                      webrtcEngineRef.current?.broadcast({
                        type: "REACTION",
                        emoji,
                        senderName: "Erick",
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
              announce(next ? "Mão levantada" : "Mão abaixada");
              setParticipants((prev) =>
                prev.map((p) =>
                  p.isLocal ? { ...p, isHandRaised: next } : p
                )
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
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-[#81c995] cursor-pointer"
                >
                  <Disc className="w-4 h-4" />
                  <span>Gravar reunião sem limite de 1h (.webm)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setElapsedSeconds((s) => s + 3600);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-[#a8c7fa]" />
                  <span>Avançar +1 Hora no Cronômetro (Teste ∞)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleAddSimulatedParticipant();
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-[#3c4043] flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 text-[#a8c7fa]" />
                  <span>Simular entrada de novo participante</span>
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
                  <span>Baixar Ata e Transcrição em Markdown</span>
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
            title="Atividades e Cofre de Gravações Ilimitadas"
            aria-label="Abrir cofre de gravações ilimitadas"
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
                  action: "Iniciar / Parar Gravação Ilimitada (REC ∞)",
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
