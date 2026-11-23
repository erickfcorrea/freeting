"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Keyboard,
  Video,
  Sparkles,
  HelpCircle,
  Settings,
  Calendar,
  Phone,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Link2,
  Plus,
  Clock,
  Infinity as InfinityIcon,
  Disc,
  Copy,
  Check,
  Trash2,
  Download,
  X,
  Mic,
  Camera,
  Database,
  Sun,
  Moon,
  Contrast,
  Globe,
  Accessibility,
  CheckCircle2,
  ExternalLink,
  Play,
} from "lucide-react";
import {
  generateRoomCode,
  extractRoomCode,
  formatShareableLink,
} from "@/domain/roomCode";
import {
  ScheduledMeeting,
  buildWeekStrip,
  formatPortugueseDateHeader,
  shiftDateByDays,
  toLocalDateIso,
  filterMeetingsForDate,
} from "@/domain/calendarSchedule";
import {
  formatUnlimitedDuration,
  formatRecordingBytes,
} from "@/domain/unlimitedRecorder";
import {
  StoredRecordingMeta,
  listRecordingsFromVault,
  assembleRecordingBlobFromVault,
  deleteRecordingFromVault,
  triggerBlobDownload,
} from "@/services/recordingVault";
import { FreetingEmptyIllustration } from "./FreetingEmptyIllustration";
import { MeetingRoomView } from "../room/MeetingRoomView";

const STORAGE_MEETINGS_KEY = "freeting_scheduled_meetings_v1";
const PUBLIC_HOSTED_URL = "https://erickfcorrea.github.io/freeting/";

export type HomeThemeMode = "light" | "dark" | "high-contrast";

export function FreetingHomeDashboard() {
  // Instant Client-Side Room Routing (Works 100% on GitHub Pages static hosting AND localhost!)
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);

  // Reference default date ("seg., 23 de nov.")
  const [selectedDate, setSelectedDate] = useState<Date>(
    () => new Date(2026, 10, 23, 12, 0, 0)
  );
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<
    "meetings" | "calls" | "recordings" | "cloud"
  >("meetings");

  // UI/UX Theme & Accessibility State
  const [theme, setTheme] = useState<HomeThemeMode>("light");
  const [fontScale, setFontScale] = useState<100 | 110 | 120>(100);
  const [a11yAnnouncement, setA11yAnnouncement] = useState(
    "Painel inicial do FREETING carregado. Reuniões e gravações sem limite de 1 hora."
  );

  // Database Engine Telemetry
  const [dbEngineStatus, setDbEngineStatus] = useState<string>(
    "SQLite + IndexedDB"
  );

  // Dropdown & Modals
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [laterRoomCode, setLaterRoomCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showAiNotesModal, setShowAiNotesModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDbHostingModal, setShowDbHostingModal] = useState(false);
  const [previewRecordingUrl, setPreviewRecordingUrl] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // Schedule Form State
  const [newTitle, setNewTitle] = useState("");
  const [newStartTime, setNewStartTime] = useState("19:00");
  const [newDescription, setNewDescription] = useState("");

  // Persisted Meetings & Recordings
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [recordings, setRecordings] = useState<StoredRecordingMeta[]>([]);

  const announce = (msg: string) => {
    setA11yAnnouncement(msg);
  };

  // Detect room code from URL query (?room=xxx) or pathname (/room/xxx) on load and popstate
  useEffect(() => {
    const syncRoomFromUrl = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const queryRoom = params.get("room");
      if (queryRoom) {
        const parsed = extractRoomCode(queryRoom);
        if (parsed) {
          setActiveRoomCode(parsed);
          return;
        }
      }
      if (window.location.pathname.includes("/room/")) {
        const pathParts = window.location.pathname.split("/room/");
        if (pathParts[1]) {
          const parsed = extractRoomCode(pathParts[1]);
          if (parsed) {
            setActiveRoomCode(parsed);
            return;
          }
        }
      }
      setActiveRoomCode(null);
    };

    syncRoomFromUrl();
    window.addEventListener("popstate", syncRoomFromUrl);
    return () => window.removeEventListener("popstate", syncRoomFromUrl);
  }, []);

  const enterRoom = useCallback((rawCode?: string) => {
    const code = rawCode ? extractRoomCode(rawCode) || rawCode : generateRoomCode();
    setShowNewMenu(false);
    setLaterRoomCode(null);
    setShowAiNotesModal(false);
    setJoinError(null);
    if (typeof window !== "undefined") {
      const basePath = window.location.pathname.startsWith("/freeting")
        ? "/freeting/"
        : "/";
      const nextUrl = `${basePath}?room=${encodeURIComponent(code)}`;
      window.history.pushState({ roomCode: code }, "", nextUrl);
    }
    setActiveRoomCode(code);
  }, []);

  const leaveRoomToHome = useCallback(() => {
    if (typeof window !== "undefined") {
      const basePath = window.location.pathname.startsWith("/freeting")
        ? "/freeting/"
        : "/";
      window.history.pushState({}, "", basePath);
    }
    setActiveRoomCode(null);
  }, []);

  const refreshRecordings = useCallback(async () => {
    const items = await listRecordingsFromVault();
    setRecordings(items);
  }, []);

  const loadMeetingsHybrid = useCallback(async () => {
    let localItems: ScheduledMeeting[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_MEETINGS_KEY);
      if (raw) {
        localItems = JSON.parse(raw);
        setMeetings(localItems);
      }
    } catch {
      // ignore
    }

    try {
      const res = await fetch("/api/meetings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.databaseEngine) {
          setDbEngineStatus(
            data.databaseEngine === "node:sqlite"
              ? "SQLite Nativo (WAL) + IndexedDB"
              : "IndexedDB + Cloud Sync"
          );
        }
        if (Array.isArray(data.meetings) && data.meetings.length > 0) {
          const mergedMap = new Map<string, ScheduledMeeting>();
          localItems.forEach((m) => mergedMap.set(m.id, m));
          data.meetings.forEach((m: ScheduledMeeting) => mergedMap.set(m.id, m));
          const merged = Array.from(mergedMap.values());
          setMeetings(merged);
          localStorage.setItem(STORAGE_MEETINGS_KEY, JSON.stringify(merged));
          return;
        }
      }
    } catch {
      setDbEngineStatus("IndexedDB Offline-First Ativo");
    }

    // Ensure at least 1 default seed meeting exists on static hosting if empty
    if (localItems.length === 0) {
      const seed: ScheduledMeeting = {
        id: "seed_mtg_1",
        title: "Sprint Review & Arquitetura FREETING (∞ Sem Limite)",
        roomCode: "amd-wraw-qkg",
        dateIso: "2026-11-23",
        startTime: "19:00",
        endTime: "∞ Sem Limite",
        hostName: "Erick Correa",
        status: "SCHEDULED",
        aiNotesEnabled: true,
        unlimitedRecordingEnabled: true,
        description: "Sala oficial do FREETING sem limite de 60 minutos.",
      };
      setMeetings([seed]);
      try {
        localStorage.setItem(STORAGE_MEETINGS_KEY, JSON.stringify([seed]));
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    loadMeetingsHybrid();
    refreshRecordings();
  }, [loadMeetingsHybrid, refreshRecordings]);

  // Refresh recordings whenever returning from a room
  useEffect(() => {
    if (!activeRoomCode) {
      refreshRecordings();
    }
  }, [activeRoomCode, refreshRecordings]);

  const persistMeetings = async (
    next: ScheduledMeeting[],
    createdItem?: ScheduledMeeting
  ) => {
    setMeetings(next);
    try {
      localStorage.setItem(STORAGE_MEETINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (createdItem) {
      try {
        await fetch("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createdItem),
        });
      } catch {
        // Offline / static hosting fallback already saved in localStorage
      }
    }
  };

  const weekStrip = buildWeekStrip(
    selectedDate,
    new Date(2026, 10, 23, 12, 0, 0)
  );
  const selectedDateIso = toLocalDateIso(selectedDate);
  const todaysMeetings = filterMeetingsForDate(meetings, selectedDateIso);

  const handleJoinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!joinInput.trim()) {
      const instantCode = generateRoomCode();
      announce(`Iniciando reunião instantânea na sala ${instantCode}`);
      enterRoom(instantCode);
      return;
    }
    const extracted = extractRoomCode(joinInput);
    if (!extracted) {
      setJoinError(
        "Digite um código válido (ex: amd-wraw-qkg) ou o nome da sala."
      );
      announce("Erro: código de sala inválido.");
      return;
    }
    setJoinError(null);
    announce(`Entrando na sala ${extracted}`);
    enterRoom(extracted);
  };

  const handleStartInstantMeeting = () => {
    const code = generateRoomCode();
    announce(`Criando sala instantânea ${code}`);
    enterRoom(code);
  };

  const handleCreateMeetingForLater = () => {
    setShowNewMenu(false);
    const code = generateRoomCode();
    setLaterRoomCode(code);
    setCopiedCode(false);
    announce(`Link criado para reunião futura: ${code}`);
  };

  const handleOpenScheduleModal = () => {
    setShowNewMenu(false);
    setNewTitle("");
    setNewStartTime("19:00");
    setNewDescription("");
    setShowScheduleModal(true);
  };

  const handleSaveScheduledMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = generateRoomCode();
    const created: ScheduledMeeting = {
      id: `mtg_${Date.now()}`,
      title: newTitle.trim() || "Reunião Sem Limite FREETING",
      roomCode: code,
      dateIso: selectedDateIso,
      startTime: newStartTime,
      endTime: "∞ Sem Limite",
      hostName: "Erick Correa",
      status: "SCHEDULED",
      aiNotesEnabled: true,
      unlimitedRecordingEnabled: true,
      description:
        newDescription.trim() ||
        "Tempo de reunião e gravação 100% ilimitados.",
    };
    await persistMeetings([...meetings, created], created);
    setShowScheduleModal(false);
    announce(
      `Reunião ${created.title} salva no banco de dados para ${created.startTime}.`
    );
  };

  const handleDeleteMeeting = async (id: string) => {
    const filtered = meetings.filter((m) => m.id !== id);
    setMeetings(filtered);
    try {
      localStorage.setItem(STORAGE_MEETINGS_KEY, JSON.stringify(filtered));
      await fetch(`/api/meetings?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      // ignore
    }
    announce("Reunião removida da agenda.");
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(true);
      announce("Link copiado para a área de transferência.");
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleDownloadRecording = async (rec: StoredRecordingMeta) => {
    const blob = await assembleRecordingBlobFromVault(
      rec.sessionId,
      rec.mimeType
    );
    if (blob) {
      triggerBlobDownload(
        blob,
        `freeting-${rec.roomCode}-${rec.sessionId}.webm`
      );
      announce(`Baixando gravação da sala ${rec.roomCode}`);
    }
  };

  const handlePreviewRecording = async (rec: StoredRecordingMeta) => {
    const blob = await assembleRecordingBlobFromVault(
      rec.sessionId,
      rec.mimeType
    );
    if (blob) {
      if (previewRecordingUrl?.url) {
        URL.revokeObjectURL(previewRecordingUrl.url);
      }
      const url = URL.createObjectURL(blob);
      setPreviewRecordingUrl({ url, title: rec.title });
    }
  };

  const handleDeleteRecording = async (sessionId: string) => {
    await deleteRecordingFromVault(sessionId);
    await refreshRecordings();
    announce("Gravação excluída do cofre local.");
  };

  // IF USER ENTERED A ROOM, RENDER THE ACTIVE MEETING ROOM DIRECTLY (ZERO 404 ON STATIC OR SERVER!)
  if (activeRoomCode) {
    return (
      <MeetingRoomView
        roomCode={activeRoomCode}
        onLeaveToHome={leaveRoomToHome}
      />
    );
  }

  const isDark = theme === "dark";
  const isHC = theme === "high-contrast";

  const rootBgClass = isHC
    ? "bg-black text-white"
    : isDark
    ? "bg-[#131314] text-[#e3e3e3]"
    : "bg-white text-[#1f1f1f]";

  const cardBgClass = isHC
    ? "bg-black border-2 border-yellow-400 text-white"
    : isDark
    ? "bg-[#1e1f20] border border-[#3c4043] text-[#e3e3e3]"
    : "bg-white border border-[#dadce0] text-[#1f1f1f]";

  return (
    <div
      style={{ fontSize: `${fontScale}%` }}
      className={`min-h-screen flex flex-col transition-colors duration-200 ${rootBgClass}`}
      onClick={() => {
        if (showNewMenu) setShowNewMenu(false);
      }}
    >
      {/* WCAG Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-[#0b57d0] focus:text-white focus:px-4 focus:py-2 focus:rounded-full focus:text-sm focus:font-semibold"
      >
        Pular para o conteúdo principal
      </a>

      {/* ARIA Live Status Region */}
      <div role="status" aria-live="polite" className="sr-only">
        {a11yAnnouncement}
      </div>

      {/* TOP HEADER BAR */}
      <header
        role="banner"
        className={`h-16 px-4 flex items-center justify-between border-b select-none ${
          isHC
            ? "border-yellow-400"
            : isDark
            ? "border-[#282a2c]"
            : "border-transparent"
        }`}
      >
        {/* Left: Monumental Neo-Classical Serif FREETING Wordmark Logo */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <svg
            width="175"
            height="32"
            viewBox="0 0 880 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="FREETING"
            className="h-8 w-auto select-none shrink-0"
          >
            <defs>
              <linearGradient
                id="headerAntiqueGold"
                x1="0"
                y1="22"
                x2="880"
                y2="138"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#D4AF37" />
                <stop offset="30%" stopColor="#B8860B" />
                <stop offset="65%" stopColor="#E6C365" />
                <stop offset="100%" stopColor="#996515" />
              </linearGradient>
            </defs>
            <g
              fill={isHC ? "#FACC15" : "url(#headerAntiqueGold)"}
              stroke={isDark || isHC ? "#FFF3D1" : "#5C4008"}
              strokeWidth="1.2"
            >
              <path d="M36 28 H114 L116 48 H110 C108 38 103 35 90 35 H68 V74 H88 C98 74 101 71 103 63 H108 V91 H103 C101 83 98 80 88 80 H68 V116 C68 123 71 126 81 127 V132 H36 V127 C46 126 49 123 49 116 V44 C49 37 46 34 36 33 V28 Z" />
              <path d="M138 28 H186 C210 28 224 39 224 56 C224 71 212 81 195 84 L222 119 C227 125 231 126 238 127 V132 H208 L177 87 H169 V116 C169 123 172 126 182 127 V132 H138 V127 C148 126 151 123 151 116 V44 C151 37 148 34 138 33 V28 Z M169 35 V80 H182 C197 80 204 72 204 57 C204 42 196 35 181 35 H169 Z" />
              <path d="M254 28 H332 L334 48 H328 C326 38 321 35 308 35 H285 V74 H304 C314 74 317 71 319 63 H324 V91 H319 C317 83 314 80 304 80 H285 V118 C285 123 288 125 296 125 H312 C325 125 331 121 335 110 H341 L337 132 H254 V127 C264 126 267 123 267 116 V44 C267 37 264 34 254 33 V28 Z" />
              <path d="M362 28 H440 L442 48 H436 C434 38 429 35 416 35 H393 V74 H412 C422 74 425 71 427 63 H432 V91 H427 C425 83 422 80 412 80 H393 V118 C393 123 396 125 404 125 H420 C433 125 439 121 443 110 H449 L445 132 H362 V127 C372 126 375 123 375 116 V44 C375 37 372 34 362 33 V28 Z" />
              <path d="M464 28 H556 L558 50 H552 C549 39 544 35 532 35 H519 V116 C519 123 523 126 534 127 V132 H486 V127 C497 126 501 123 501 116 V35 H488 C476 35 471 39 468 50 H462 L464 28 Z" />
              <path d="M576 28 H622 V33 C612 34 608 37 608 44 V116 C608 123 612 126 622 127 V132 H576 V127 C586 126 590 123 590 116 V44 C590 37 586 34 576 33 V28 Z" />
              <path d="M642 28 H672 L724 103 V44 C724 37 720 34 710 33 V28 H746 V33 C736 34 732 37 732 44 V133 H724 L663 46 V116 C663 123 667 126 677 127 V132 H642 V127 C652 126 655 123 655 116 V44 C655 37 652 34 642 33 V28 Z" />
              <path d="M816 26 C832 26 844 30 854 34 L856 56 H850 C845 41 833 33 816 33 C792 33 777 51 777 80 C777 109 793 127 818 127 C827 127 834 125 838 122 V96 C838 88 834 85 823 84 V79 H864 V84 C857 85 855 88 855 95 V125 C844 131 831 134 816 134 C781 134 757 112 757 80 C757 47 782 26 816 26 Z" />
            </g>
          </svg>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDbHostingModal(true)}
              title="Banco de Dados SQLite + Hospedagem Gratuita Ativa"
              className="hidden xl:inline-flex items-center gap-1.5 text-[11px] font-semibold bg-[#e6f4ea] text-[#137333] hover:bg-[#ceead6] px-2.5 py-1 rounded-full border border-[#ceead6] transition-colors cursor-pointer"
            >
              <InfinityIcon className="w-3.5 h-3.5" />
              <span>Sem Limites • {dbEngineStatus}</span>
            </button>
          </div>
        </div>

        {/* Center Action Bar: Code Input + Participar + Nova + Anotações IA */}
        <div
          className="flex items-center gap-2.5 flex-wrap justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <form
            onSubmit={handleJoinRoom}
            role="search"
            aria-label="Entrar em uma reunião com código ou link"
            className={`flex items-center rounded-full h-11 pl-4 pr-1.5 transition-all ${
              isHC
                ? "bg-black border-2 border-yellow-400"
                : isDark
                ? "bg-[#282a2c] hover:bg-[#323537] focus-within:ring-2 focus-within:ring-[#8ab4f8]"
                : "bg-[#f1f3f4] hover:bg-[#e8eaed] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0b57d0]"
            }`}
          >
            <Keyboard
              className={`w-5 h-5 mr-2.5 shrink-0 ${
                isHC
                  ? "text-yellow-300"
                  : isDark
                  ? "text-[#9aa0a6]"
                  : "text-[#5f6368]"
              }`}
            />
            <input
              type="text"
              value={joinInput}
              onChange={(e) => {
                setJoinInput(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="Digite um código ou link"
              aria-label="Digite um código ou link da reunião"
              className="bg-transparent text-sm placeholder-[#5f6368] focus:outline-none w-44 sm:w-52"
            />
            <button
              type="submit"
              className={`ml-2 px-4 h-8 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                joinInput.trim()
                  ? "bg-[#0b57d0] text-white hover:bg-[#0842a0]"
                  : "bg-[#0b57d0] text-white hover:bg-[#0842a0]"
              }`}
            >
              Participar
            </button>
          </form>

          {/* "+ Nova" Green Pill Button with Dropdown */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={showNewMenu}
              aria-haspopup="menu"
              onClick={() => setShowNewMenu((v) => !v)}
              className="h-11 px-4 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-semibold flex items-center gap-2 transition-transform active:scale-95 cursor-pointer shadow-2xs"
            >
              <Video className="w-4 h-4" />
              <span>Nova</span>
            </button>

            {showNewMenu && (
              <div
                role="menu"
                className={`absolute left-0 mt-2 w-72 rounded-2xl shadow-2xl py-2 z-50 ${cardBgClass}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleStartInstantMeeting}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#0b57d0]/10 flex items-center gap-3 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#137333]" />
                  <div>
                    <div className="font-semibold">
                      Iniciar uma reunião instantânea
                    </div>
                    <div className="text-xs text-[#137333] font-medium">
                      Entrar agora • Gravação ∞ liberada
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleCreateMeetingForLater}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#0b57d0]/10 flex items-center gap-3 cursor-pointer"
                >
                  <Link2 className="w-4 h-4 text-[#0b57d0]" />
                  <div>
                    <div className="font-medium">
                      Criar uma reunião para depois
                    </div>
                    <div className="text-xs opacity-75">
                      Gere um link sem limite de tempo
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleOpenScheduleModal}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#0b57d0]/10 flex items-center gap-3 cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-[#0b57d0]" />
                  <div>
                    <div className="font-medium">Agendar no Banco SQLite</div>
                    <div className="text-xs opacity-75">
                      Salvar no calendário semanal
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* "Anotações feitas por IA" Light Blue Pill Button */}
          <button
            type="button"
            onClick={() => setShowAiNotesModal(true)}
            className="h-11 px-4 rounded-full bg-[#d3e3fd] hover:bg-[#c2d7fa] text-[#041e49] text-sm font-semibold flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#0b57d0]" />
            <span className="max-w-[130px] truncate">Anotações feit...</span>
          </button>
        </div>

        {/* Right Icons */}
        <div className="flex items-center gap-1.5 min-w-[210px] justify-end">
          <button
            type="button"
            onClick={() => {
              const nextTheme: HomeThemeMode =
                theme === "light"
                  ? "dark"
                  : theme === "dark"
                  ? "high-contrast"
                  : "light";
              setTheme(nextTheme);
              announce(
                `Tema alterado para ${
                  nextTheme === "light"
                    ? "Modo Claro"
                    : nextTheme === "dark"
                    ? "Modo Escuro"
                    : "Alto Contraste Acessível"
                }`
              );
            }}
            aria-label="Alternar tema visual e alto contraste"
            title="Alternar tema: Claro / Escuro / Alto Contraste (WCAG AAA)"
            className="w-9 h-9 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center cursor-pointer"
          >
            {theme === "light" && <Sun className="w-5 h-5 text-[#5f6368]" />}
            {theme === "dark" && <Moon className="w-5 h-5 text-[#a8c7fa]" />}
            {theme === "high-contrast" && (
              <Contrast className="w-5 h-5 text-yellow-300" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              const nextScale =
                fontScale === 100 ? 110 : fontScale === 110 ? 120 : 100;
              setFontScale(nextScale);
              announce(`Tamanho da fonte ajustado para ${nextScale}%`);
            }}
            aria-label="Ajustar tamanho da fonte para acessibilidade"
            title={`Acessibilidade: Escala de Fonte (${fontScale}%)`}
            className="px-2.5 h-8 rounded-full border border-[#dadce0] dark:border-[#3c4043] text-xs font-bold hover:bg-[#0b57d0]/10 flex items-center gap-1 cursor-pointer"
          >
            <Accessibility className="w-3.5 h-3.5 text-[#0b57d0]" />
            <span>{fontScale}%</span>
          </button>

          <button
            type="button"
            onClick={() => setShowDbHostingModal(true)}
            title="Banco de Dados SQLite & Hospedagem Gratuita"
            aria-label="Ver arquitetura de Banco de Dados e Domínio Gratuito"
            className="w-9 h-9 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center text-[#0b57d0] cursor-pointer"
          >
            <Database className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowSecurityModal(true)}
            title="Segurança e Recursos Sem Limite"
            aria-label="Segurança e Recursos Sem Limite"
            className="w-9 h-9 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center opacity-80 cursor-pointer"
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            title="Configurações de Áudio, Vídeo e Gravação Ilimitada"
            aria-label="Configurações"
            className="w-9 h-9 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center opacity-80 cursor-pointer"
          >
            <Settings className="w-5 h-5" />
          </button>

          <div
            title="Erick Correa (Conta Ilimitada FREETING)"
            className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0b57d0] to-[#137333] p-0.5 ml-1 cursor-pointer"
          >
            <div className="w-full h-full rounded-full bg-[#1a73e8] text-white text-sm font-semibold flex items-center justify-center">
              E
            </div>
          </div>
        </div>
      </header>

      {joinError && (
        <div
          role="alert"
          className="mx-auto mt-1 text-xs text-[#d93025] bg-[#fce8e6] px-4 py-1.5 rounded-full"
        >
          {joinError}
        </div>
      )}

      {/* BODY: LEFT NAVIGATION RAIL + MAIN CONTENT */}
      <div className="flex-1 flex">
        <nav
          aria-label="Menu principal lateral"
          className="w-20 pt-6 flex flex-col items-center gap-5 select-none shrink-0"
        >
          <button
            type="button"
            onClick={() => setActiveNav("meetings")}
            aria-current={activeNav === "meetings" ? "page" : undefined}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "meetings"
                  ? "bg-[#c2e7ff] text-[#001d35]"
                  : "opacity-75 group-hover:bg-[#0b57d0]/10"
              }`}
            >
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium">Reuniões</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav("calls")}
            aria-current={activeNav === "calls" ? "page" : undefined}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "calls"
                  ? "bg-[#c2e7ff] text-[#001d35]"
                  : "opacity-75 group-hover:bg-[#0b57d0]/10"
              }`}
            >
              <Phone className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium">Ligações</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveNav("recordings");
              refreshRecordings();
            }}
            aria-current={activeNav === "recordings" ? "page" : undefined}
            className="flex flex-col items-center gap-1 group cursor-pointer relative"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "recordings"
                  ? "bg-[#c4eed0] text-[#0f5223]"
                  : "opacity-75 group-hover:bg-[#0b57d0]/10"
              }`}
            >
              <Disc className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium">Gravações ∞</span>
            {recordings.length > 0 && (
              <span className="absolute -top-1 right-2 bg-[#0f5223] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {recordings.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveNav("cloud")}
            aria-current={activeNav === "cloud" ? "page" : undefined}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "cloud"
                  ? "bg-[#d3e3fd] text-[#041e49]"
                  : "opacity-75 group-hover:bg-[#0b57d0]/10"
              }`}
            >
              <Globe className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium">Domínio & DB</span>
          </button>
        </nav>

        {/* Main Content Container */}
        <main
          id="main-content"
          className="flex-1 max-w-4xl mx-auto px-6 pt-5 pb-16"
        >
          {activeNav === "meetings" && (
            <>
              {/* Date Strip Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-[22px] font-normal">
                    {formatPortugueseDateHeader(selectedDate)}
                  </h1>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDate(new Date(2026, 10, 23, 12, 0, 0))
                    }
                    title="Voltar para seg., 23 de nov."
                    aria-label="Voltar para a data de referência 23 de novembro"
                    className="p-1.5 rounded-full hover:bg-[#0b57d0]/10 opacity-80 cursor-pointer"
                  >
                    <Calendar className="w-4 h-4" />
                  </button>
                </div>

                {/* 7-Day Week Selector Strip */}
                <div
                  role="group"
                  aria-label="Seletor de dias da semana"
                  className="flex items-center gap-1.5 select-none"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDate((d) => shiftDateByDays(d, -7))
                    }
                    aria-label="Semana anterior"
                    className="w-8 h-8 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 sm:gap-2">
                    {weekStrip.map((day) => (
                      <button
                        key={day.dateIso}
                        type="button"
                        aria-pressed={day.isSelected}
                        onClick={() => {
                          const [y, m, d] = day.dateIso.split("-").map(Number);
                          setSelectedDate(new Date(y, m - 1, d, 12, 0, 0));
                        }}
                        className={`w-10 py-1.5 rounded-full flex flex-col items-center justify-center transition-all cursor-pointer ${
                          day.isSelected
                            ? "bg-[#a8c7fa] text-[#041e49] font-bold shadow-xs scale-105"
                            : "hover:bg-[#0b57d0]/10 opacity-80"
                        }`}
                      >
                        <span className="text-[10px] tracking-wider uppercase leading-tight">
                          {day.dayOfWeekShort}
                        </span>
                        <span className="text-sm leading-tight mt-0.5">
                          {day.dayNumber}
                        </span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDate((d) => shiftDateByDays(d, 7))
                    }
                    aria-label="Próxima semana"
                    className="w-8 h-8 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Security & Unlimited Info Banner */}
              <div
                className={`rounded-3xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 ${
                  isHC
                    ? "bg-black border-2 border-yellow-400 text-white"
                    : isDark
                    ? "bg-[#1b3a6b]/50 border border-[#8ab4f8]/30 text-white"
                    : "bg-[#e8f0fe] text-[#1f1f1f]"
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-9 h-9 rounded-full bg-[#1a73e8] text-white flex items-center justify-center shrink-0 shadow-xs">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="text-xs sm:text-[13px] leading-snug">
                    <div className="font-semibold">
                      Sua reunião está segura • Duração e Gravação 100% Sem
                      Limites (∞)
                    </div>
                    <div className="opacity-80">
                      As pessoas só podem participar de uma reunião se o
                      organizador convidar ou permitir — sem corte de 60
                      minutos.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleStartInstantMeeting}
                    className="bg-[#0b57d0] hover:bg-[#0842a0] text-white rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Entrar em Sala Agora
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSecurityModal(true)}
                    className="bg-white text-[#1f1f1f] hover:bg-[#f1f3f4] border border-[#dadce0] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Saiba mais
                  </button>
                </div>
              </div>

              {/* Feature Cards Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                <button
                  type="button"
                  onClick={handleStartInstantMeeting}
                  className={`p-3.5 rounded-2xl flex items-center gap-3 text-left hover:border-[#137333] transition-colors cursor-pointer ${cardBgClass}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#e6f4ea] text-[#137333] flex items-center justify-center shrink-0">
                    <InfinityIcon className="w-5 h-5" />
                  </div>
                  <div className="text-xs">
                    <div className="font-semibold">
                      Iniciar Sala Sem Limite (1h+)
                    </div>
                    <div className="opacity-70">
                      Clique para abrir sala instantânea
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveNav("recordings");
                    refreshRecordings();
                  }}
                  className={`p-3.5 rounded-2xl flex items-center gap-3 text-left hover:border-[#c5221f] transition-colors cursor-pointer ${cardBgClass}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#fce8e6] text-[#c5221f] flex items-center justify-center shrink-0">
                    <Disc className="w-5 h-5" />
                  </div>
                  <div className="text-xs">
                    <div className="font-semibold">Gravador Chunked ∞</div>
                    <div className="opacity-70">
                      Salva em chunks de 1s no IndexedDB
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveNav("cloud")}
                  className={`p-3.5 rounded-2xl flex items-center gap-3 text-left hover:border-[#0b57d0] transition-colors cursor-pointer ${cardBgClass}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#e8f0fe] text-[#0b57d0] flex items-center justify-center shrink-0">
                    <Database className="w-5 h-5" />
                  </div>
                  <div className="text-xs">
                    <div className="font-semibold">SQLite + Domínio Grátis</div>
                    <div className="opacity-70">
                      Ver banco e URL pública ativa
                    </div>
                  </div>
                </button>
              </div>

              {/* Scheduled Meetings or Empty State Illustration */}
              {todaysMeetings.length === 0 ? (
                <div className="text-center pt-4 pb-10">
                  <FreetingEmptyIllustration />
                  <h2 className="text-[22px] font-normal mt-4">
                    Nenhuma reunião agendada para hoje
                  </h2>
                  <p className="text-sm opacity-75 mt-1.5 mb-6">
                    Agende uma reunião ou inicie uma sala instantânea sem limite
                    de tempo
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={handleStartInstantMeeting}
                      className="h-11 px-6 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>Iniciar Reunião Agora</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenScheduleModal}
                      className="h-11 px-5 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Agendar no SQLite</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider opacity-75">
                      Reuniões agendadas para este dia ({todaysMeetings.length})
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleStartInstantMeeting}
                        className="text-xs font-semibold text-[#137333] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Iniciar reunião instantânea
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenScheduleModal}
                        className="text-xs font-semibold text-[#0b57d0] dark:text-[#8ab4f8] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agendar outra reunião
                      </button>
                    </div>
                  </div>

                  {todaysMeetings.map((mtg) => (
                    <div
                      key={mtg.id}
                      className={`hover:border-[#0b57d0] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all shadow-2xs ${cardBgClass}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-xs font-semibold text-[#0b57d0] bg-[#e8f0fe] px-2.5 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {mtg.startTime} • {mtg.endTime}
                          </span>
                          <span className="text-xs font-medium bg-[#e6f4ea] text-[#137333] px-2.5 py-0.5 rounded-full">
                            Gravação ∞ Liberada
                          </span>
                          <span className="text-[11px] bg-[#f1f3f4] text-[#444746] px-2 py-0.5 rounded-full">
                            Salvo no SQLite
                          </span>
                        </div>
                        <h3 className="text-base font-semibold">{mtg.title}</h3>
                        <p className="text-xs opacity-75">
                          Sala:{" "}
                          <code className="font-mono font-bold">
                            {mtg.roomCode}
                          </code>{" "}
                          • {mtg.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(
                              formatShareableLink(
                                mtg.roomCode,
                                typeof window !== "undefined"
                                  ? window.location.origin
                                  : undefined
                              )
                            )
                          }
                          className="px-3 py-2 rounded-full border border-[#dadce0] hover:bg-[#0b57d0]/10 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copiar link
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMeeting(mtg.id)}
                          aria-label={`Excluir reunião ${mtg.title}`}
                          className="p-2 rounded-full hover:bg-[#fce8e6] text-[#d93025] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => enterRoom(mtg.roomCode)}
                          className="px-5 py-2 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-semibold cursor-pointer shadow-xs"
                        >
                          Participar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeNav === "calls" && (
            <div className="py-6 space-y-6">
              <div className={`rounded-3xl p-8 text-center ${cardBgClass}`}>
                <div className="w-14 h-14 rounded-full bg-[#c2e7ff] text-[#001d35] flex items-center justify-center mx-auto mb-4">
                  <Phone className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-medium">
                  Ligações Diretas P2P Sem Limite de Tempo
                </h2>
                <p className="text-sm opacity-75 max-w-md mx-auto mt-2 mb-6">
                  Inicie uma chamada direta WebRTC com áudio e vídeo em alta
                  definição, compartilhamento de tela e gravação contínua.
                </p>
                <div className="flex justify-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleStartInstantMeeting}
                    className="h-11 px-6 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Video className="w-4 h-4" />
                    Iniciar Ligação Instantânea (∞)
                  </button>
                  <button
                    type="button"
                    onClick={() => enterRoom("amd-wraw-qkg")}
                    className="h-11 px-6 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                  >
                    Entrar na Sala Oficial (amd-wraw-qkg)
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeNav === "recordings" && (
            <div className="py-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-medium flex items-center gap-2">
                    <Disc className="w-5 h-5 text-[#0f5223]" />
                    Cofre de Gravações Ilimitadas (IndexedDB)
                  </h2>
                  <p className="text-xs opacity-75 mt-0.5">
                    Todas as gravações são salvas localmente em chunks contínuos
                    de 1 segundo, sem limite de 1 hora.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStartInstantMeeting}
                  className="px-4 py-2 rounded-full bg-[#c4eed0] text-[#0f5223] text-xs font-semibold cursor-pointer"
                >
                  + Nova Sala para Gravar
                </button>
              </div>

              {recordings.length === 0 ? (
                <div className="border border-dashed border-[#dadce0] rounded-2xl p-10 text-center text-sm opacity-75">
                  Nenhuma gravação salva ainda. Entre em uma reunião e clique no
                  botão <strong>Gravar ∞</strong> na barra inferior para gravar
                  sem limite de tempo!
                </div>
              ) : (
                <div className="space-y-3">
                  {recordings.map((rec) => (
                    <div
                      key={rec.sessionId}
                      className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${cardBgClass}`}
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">
                            {rec.title}
                          </span>
                          <span className="text-xs bg-[#e6f4ea] text-[#137333] px-2 py-0.5 rounded-full font-medium">
                            {formatUnlimitedDuration(rec.durationSeconds)} •{" "}
                            {formatRecordingBytes(rec.totalBytes)}
                          </span>
                        </div>
                        <div className="text-xs opacity-75 mt-1">
                          Sala: <code>{rec.roomCode}</code> • {rec.chunkCount}{" "}
                          chunks gravados •{" "}
                          {new Date(rec.startedAtIso).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePreviewRecording(rec)}
                          className="px-3.5 py-2 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Assistir
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadRecording(rec)}
                          className="px-4 py-2 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Baixar .webm
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecording(rec.sessionId)}
                          className="p-2 rounded-full hover:bg-[#fce8e6] text-[#d93025] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeNav === "cloud" && (
            <div className="py-4 space-y-5">
              <div className={`rounded-3xl p-6 space-y-4 ${cardBgClass}`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-[#e8f0fe] text-[#0b57d0] flex items-center justify-center">
                      <Globe className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">
                        Hospedagem & Domínio Gratuitos + Banco de Dados Híbrido
                      </h2>
                      <p className="text-xs opacity-75">
                        Arquitetura com custo R$ 0,00 e salas ilimitadas
                      </p>
                    </div>
                  </div>
                  <a
                    href={PUBLIC_HOSTED_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <span>Abrir Domínio Público</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-4 rounded-2xl bg-[#e6f4ea]/60 border border-[#ceead6] text-[#137333] space-y-2">
                    <div className="font-bold text-sm flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      1. Banco de Dados Híbrido Ativo
                    </div>
                    <p className="text-xs leading-relaxed">
                      •{" "}
                      <strong>
                        Servidor (`node:sqlite` — `data/freeting.sqlite`):
                      </strong>{" "}
                      Armazena agendamentos, salas e atas em SQLite com modo
                      WAL.
                      <br />•{" "}
                      <strong>
                        Cliente (`IndexedDB` —
                        `freeting_unlimited_recordings_db`):
                      </strong>{" "}
                      Armazena os chunks de vídeo `.webm` de longa duração (1h,
                      3h, 10h+) diretamente no navegador sem estourar limites de
                      nuvem gratuita!
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#e8f0fe]/60 border border-[#d3e3fd] text-[#041e49] space-y-2">
                    <div className="font-bold text-sm flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-[#0b57d0]" />
                      2. Domínio & Hospedagem Gratuita
                    </div>
                    <p className="text-xs leading-relaxed">
                      • <strong>GitHub Pages Ativo:</strong>{" "}
                      <code className="font-mono font-bold">
                        {PUBLIC_HOSTED_URL}
                      </code>
                      <br />• <strong>CI/CD Automático:</strong> Workflow
                      `.github/workflows/deploy-pages.yml` + branch `gh-pages` +
                      suporte `vercel.json` prontos.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL: Reprodutor de Vídeo de Gravação Salva */}
      {previewRecordingUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-[#1e1f20] text-white rounded-3xl max-w-3xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {previewRecordingUrl.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewRecordingUrl.url);
                  setPreviewRecordingUrl(null);
                }}
                className="p-1.5 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <video
              src={previewRecordingUrl.url}
              controls
              autoPlay
              className="w-full rounded-2xl bg-black max-h-[65vh]"
            />
          </div>
        </div>
      )}

      {/* MODAL: Arquitetura de Banco de Dados & Domínio Gratuito */}
      {showDbHostingModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Database className="w-5 h-5 text-[#0b57d0]" />
                Banco de Dados Híbrido & Domínio Gratuito
              </h3>
              <button
                type="button"
                onClick={() => setShowDbHostingModal(false)}
                className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-[#444746] space-y-3 leading-relaxed">
              <div className="p-3.5 rounded-2xl bg-[#f8f9fa] border border-[#dadce0]">
                <div className="font-bold text-[#1f1f1f] mb-1">
                  Por que usamos SQLite + IndexedDB Híbrido?
                </div>
                Agendamentos e atas são leves e ficam salvos no banco relacional{" "}
                <strong>SQLite (`data/freeting.sqlite`)</strong> + cache
                sincronizado. Já as gravações de vídeo de várias horas (`.webm`)
                são salvas em chunks de 1s no <strong>IndexedDB</strong> do
                navegador — garantindo gravação infinita sem custo de servidor!
              </div>
              <div className="p-3.5 rounded-2xl bg-[#e8f0fe] border border-[#d3e3fd]">
                <div className="font-bold text-[#041e49] mb-1">
                  Domínio Gratuito Publicado:
                </div>
                <a
                  href={PUBLIC_HOSTED_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0b57d0] font-mono font-bold underline break-all"
                >
                  {PUBLIC_HOSTED_URL}
                </a>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowDbHostingModal(false)}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: "Veja o link da sua reunião" */}
      {laterRoomCode && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">
                Veja o link da sua reunião
              </h3>
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#5f6368] mb-4">
              Copie este link e envie para as pessoas com quem você quer se
              reunir. Esta sala possui duração e gravação ilimitadas (∞).
            </p>
            <div className="bg-[#f1f3f4] rounded-xl px-4 py-3 flex items-center justify-between gap-2 mb-5">
              <span className="text-sm font-mono truncate">
                {formatShareableLink(
                  laterRoomCode,
                  typeof window !== "undefined"
                    ? window.location.origin
                    : undefined
                )}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    formatShareableLink(
                      laterRoomCode,
                      typeof window !== "undefined"
                        ? window.location.origin
                        : undefined
                    )
                  )
                }
                className="p-2 rounded-full hover:bg-[#e0e2e5] cursor-pointer shrink-0"
              >
                {copiedCode ? (
                  <Check className="w-4 h-4 text-[#137333]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                className="px-4 py-2 rounded-full text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  const code = laterRoomCode;
                  setLaterRoomCode(null);
                  enterRoom(code);
                }}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0842a0] cursor-pointer"
              >
                Entrar agora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Agendar Reunião Sem Limite no SQLite */}
      {showScheduleModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
        >
          <form
            onSubmit={handleSaveScheduledMeeting}
            className="bg-white text-[#1f1f1f] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">
                Agendar Reunião no Banco SQLite (∞)
              </h3>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5f6368] mb-1">
                Título da reunião
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Revisão de Arquitetura Sem Limite"
                className="w-full border border-[#dadce0] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#0b57d0]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] mb-1">
                  Data selecionada
                </label>
                <input
                  type="text"
                  disabled
                  value={formatPortugueseDateHeader(selectedDate)}
                  className="w-full bg-[#f1f3f4] border border-[#dadce0] rounded-xl px-3.5 py-2.5 text-sm text-[#5f6368]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5f6368] mb-1">
                  Horário de início
                </label>
                <input
                  type="time"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  className="w-full border border-[#dadce0] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#0b57d0]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5f6368] mb-1">
                Descrição / Pauta
              </label>
              <textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Reunião com gravação ilimitada e anotações automáticas em português."
                className="w-full border border-[#dadce0] rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-[#0b57d0]"
              />
            </div>
            <div className="bg-[#e6f4ea] text-[#137333] rounded-xl p-3 text-xs flex items-center gap-2">
              <InfinityIcon className="w-4 h-4 shrink-0" />
              <span>
                Persistido automaticamente em{" "}
                <strong>SQLite (`data/freeting.sqlite`)</strong> + sincronização
                local.
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 rounded-full text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0842a0] cursor-pointer"
              >
                Salvar na Agenda
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: Anotações feitas por IA */}
      {showAiNotesModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#d3e3fd] text-[#0b57d0] flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-medium">
                  Anotações feitas por IA & Gravação ∞
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#444746]">
              No <strong>FREETING</strong>, o assistente de IA em Português e a
              gravação contínua estão liberados gratuitamente em todas as salas,
              sem limite de 60 minutos.
            </p>
            <ul className="space-y-2.5 text-xs text-[#444746] bg-[#f8f9fa] p-4 rounded-2xl border border-[#dadce0]">
              <li>
                • <strong>Gravação Contínua em Chunks (1s):</strong> Salva áudio
                mixado + vídeo diretamente no IndexedDB sem estourar a memória
                RAM.
              </li>
              <li>
                • <strong>Transcrição ao Vivo (pt-BR):</strong> Reconhecimento
                de voz contínuo com identificação de orador.
              </li>
              <li>
                • <strong>Exportação Instantânea:</strong> Baixe o vídeo `.webm`
                e a Ata completa em Markdown (`.md`) ao encerrar.
              </li>
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                className="px-4 py-2 rounded-full text-sm text-[#5f6368] hover:bg-[#f1f3f4] cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => enterRoom("amd-wraw-qkg")}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0842a0] cursor-pointer"
              >
                Entrar na Sala amd-wraw-qkg
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Segurança & Recursos Ilimitados */}
      {showSecurityModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#1a73e8]" />
                Segurança & Recursos Ilimitados FREETING
              </h3>
              <button
                type="button"
                onClick={() => setShowSecurityModal(false)}
                className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-sm text-[#444746] space-y-2">
              <p>
                O <strong>FREETING</strong> foi projetado com criptografia
                WebRTC P2P e arquitetura sem limites de tempo ou gravação:
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                <div className="p-3 rounded-xl bg-[#fce8e6] text-[#c5221f]">
                  <div className="font-bold mb-1">Plataformas Tradicionais</div>
                  <div>• Limite rígido de 60 min no plano grátis</div>
                  <div>• Gravação bloqueada em contas gratuitas</div>
                  <div>• Sem download local imediato em WebM</div>
                </div>
                <div className="p-3 rounded-xl bg-[#e6f4ea] text-[#137333]">
                  <div className="font-bold mb-1">FREETING (Sem Limites)</div>
                  <div>• Duração 100% Ilimitada (∞ horas)</div>
                  <div>• Gravação chunked IndexedDB nativa</div>
                  <div>• SQLite + IA em Português + .webm/.md</div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowSecurityModal(false)}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Configurações Pre-Flight de Dispositivos */}
      {showSettingsModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#5f6368]" />
                Configurações de Áudio, Vídeo e Acessibilidade
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-xl bg-[#f8f9fa] border border-[#dadce0] flex items-center gap-3">
                <Mic className="w-5 h-5 text-[#0b57d0]" />
                <div>
                  <div className="font-medium">
                    Microfone Padrão + Web Speech API (pt-BR)
                  </div>
                  <div className="text-xs text-[#5f6368]">
                    Mixagem Web Audio API e transcrição ao vivo ativas
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#f8f9fa] border border-[#dadce0] flex items-center gap-3">
                <Camera className="w-5 h-5 text-[#0b57d0]" />
                <div>
                  <div className="font-medium">
                    Câmera HD + Câmera Virtual Studio 720p
                  </div>
                  <div className="text-xs text-[#5f6368]">
                    Fallback automático para vídeo 30fps mesmo sem webcam física
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#e6f4ea] border border-[#ceead6] flex items-center gap-3">
                <Disc className="w-5 h-5 text-[#137333]" />
                <div>
                  <div className="font-medium text-[#137333]">
                    Motor UnlimitedRecorderEngine
                  </div>
                  <div className="text-xs text-[#137333]">
                    Flush contínuo a cada 1000ms (Sem limite de 1 hora)
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium cursor-pointer"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
