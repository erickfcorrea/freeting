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
  Disc,
  Copy,
  Check,
  Trash2,
  Download,
  X,
  Mic,
  Camera,
  Sun,
  Moon,
  Contrast,
  Accessibility,
  Play,
  Share2,
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
  getRecordingFileExtension,
} from "@/services/recordingVault";
import {
  LgpdConsentRecord,
  DEFAULT_LGPD_CONSENT,
  loadLgpdConsent,
  saveLgpdConsent,
} from "@/domain/lgpdCompliance";
import { validateAndSanitizeMeetingInput } from "@/domain/securityGuard";
import { FreetingEmptyIllustration } from "./FreetingEmptyIllustration";
import { MeetingRoomView } from "../room/MeetingRoomView";

const STORAGE_MEETINGS_KEY = "freeting_scheduled_meetings_v2";

export type HomeThemeMode = "light" | "dark" | "high-contrast";

export function FreetingHomeDashboard() {
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [isRoomCreator, setIsRoomCreator] = useState<boolean>(false);

  const [selectedDate, setSelectedDate] = useState<Date>(
    () => new Date(2026, 10, 23, 12, 0, 0)
  );
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<
    "meetings" | "calls" | "recordings"
  >("meetings");

  // UI/UX Theme & Accessibility State
  const [theme, setTheme] = useState<HomeThemeMode>("light");
  const [fontScale, setFontScale] = useState<100 | 115 | 130>(100);
  const [a11yAnnouncement, setA11yAnnouncement] = useState(
    "Painel inicial do FREETING carregado."
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.fontSize = `${fontScale}%`;
    }
  }, [fontScale]);

  // Dropdown & Modals
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [laterRoomCode, setLaterRoomCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showAiNotesModal, setShowAiNotesModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [previewRecordingUrl, setPreviewRecordingUrl] = useState<{
    url: string;
    title: string;
  } | null>(null);

  // Schedule Form State
  const [newTitle, setNewTitle] = useState("");
  const [newStartTime, setNewStartTime] = useState("19:00");
  const [newDescription, setNewDescription] = useState("");

  // Meetings, Recordings & LGPD Consent
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [recordings, setRecordings] = useState<StoredRecordingMeta[]>([]);
  const [lgpdConsent, setLgpdConsent] =
    useState<LgpdConsentRecord>(DEFAULT_LGPD_CONSENT);
  const [lgpdFeedback, setLgpdFeedback] = useState<string | null>(null);

  const announce = (msg: string) => {
    setA11yAnnouncement(msg);
  };

  useEffect(() => {
    const syncRoomFromUrl = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const queryRoom = params.get("room");
      if (queryRoom) {
        const parsed = extractRoomCode(queryRoom);
        if (parsed) {
          setIsRoomCreator(false);
          setActiveRoomCode(parsed);
          return;
        }
      }
      if (window.location.pathname.includes("/room/")) {
        const pathParts = window.location.pathname.split("/room/");
        if (pathParts[1]) {
          const parsed = extractRoomCode(pathParts[1]);
          if (parsed) {
            setIsRoomCreator(false);
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

  const enterRoom = useCallback((rawCode?: string, asCreator = false) => {
    const code = rawCode
      ? extractRoomCode(rawCode) || rawCode
      : generateRoomCode();
    setShowNewMenu(false);
    setLaterRoomCode(null);
    setShowAiNotesModal(false);
    setJoinError(null);
    setIsRoomCreator(asCreator);
    if (typeof window !== "undefined") {
      const basePath = window.location.pathname.startsWith("/freeting")
        ? "/freeting/"
        : "/";
      const nextUrl = `${basePath}?room=${encodeURIComponent(code)}`;
      window.history.pushState({ roomCode: code, asCreator }, "", nextUrl);
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

  const loadMeetings = useCallback(async () => {
    let localItems: ScheduledMeeting[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_MEETINGS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localItems = parsed
            .slice(0, 200)
            .map((item) =>
              validateAndSanitizeMeetingInput(item, generateRoomCode())
            )
            .filter(
              (item): item is NonNullable<typeof item> => item !== null
            );
          setMeetings(localItems);
        }
      }
    } catch {
      // ignore corrupted storage
    }

    try {
      const res = await fetch("/api/meetings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.meetings) && data.meetings.length > 0) {
          const mergedMap = new Map<string, ScheduledMeeting>();
          localItems.forEach((m) => mergedMap.set(m.id, m));
          data.meetings.forEach((m: ScheduledMeeting) =>
            mergedMap.set(m.id, m)
          );
          const merged = Array.from(mergedMap.values());
          setMeetings(merged);
          localStorage.setItem(STORAGE_MEETINGS_KEY, JSON.stringify(merged));
        }
      }
    } catch {
      // Offline mode
    }
  }, []);

  useEffect(() => {
    loadMeetings();
    refreshRecordings();
    setLgpdConsent(loadLgpdConsent());
  }, [loadMeetings, refreshRecordings]);

  useEffect(() => {
    if (!activeRoomCode) {
      refreshRecordings();
    }
  }, [activeRoomCode, refreshRecordings]);

  const handleExportLgpdDataPortability = () => {
    const payload = {
      platform: "FREETING",
      legalBasis: "LGPD Art. 18, V - Portabilidade de Dados",
      exportedAtIso: new Date().toISOString(),
      consent: lgpdConsent,
      scheduledMeetings: meetings,
      recordingsMetadata: recordings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    triggerBlobDownload(blob, "freeting-portabilidade-dados-lgpd.json");
    setLgpdFeedback(
      "Arquivo de portabilidade de dados (JSON) exportado com sucesso."
    );
  };

  const handleEraseAllPersonalDataLgpd = async () => {
    for (const rec of recordings) {
      await deleteRecordingFromVault(rec.sessionId);
    }
    for (const mtg of meetings) {
      try {
        await fetch(`/api/meetings?id=${encodeURIComponent(mtg.id)}`, {
          method: "DELETE",
        });
      } catch {
        // ignore
      }
    }
    try {
      localStorage.removeItem(STORAGE_MEETINGS_KEY);
    } catch {
      // ignore
    }
    setMeetings([]);
    setRecordings([]);
    setLgpdFeedback(
      "Todos os agendamentos e gravações foram permanentemente eliminados (Art. 18, VI da LGPD)."
    );
  };

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
        // Offline fallback
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
      announce(`Iniciando reunião na sala ${instantCode}`);
      enterRoom(instantCode, true);
      return;
    }
    const extracted = extractRoomCode(joinInput);
    if (!extracted) {
      setJoinError(
        "Digite um código válido (ex: amd-wraw-qkg) ou cole o link da reunião."
      );
      announce("Erro: código de sala inválido.");
      return;
    }
    setJoinError(null);
    announce(`Preparando para entrar na sala ${extracted}`);
    enterRoom(extracted, false);
  };

  const handleStartInstantMeeting = () => {
    const code = generateRoomCode();
    announce(`Iniciando reunião instantânea ${code}`);
    enterRoom(code, true);
  };

  const handleCreateMeetingForLater = () => {
    setShowNewMenu(false);
    const code = generateRoomCode();
    setLaterRoomCode(code);
    setCopiedCode(false);
    announce(`Link criado para reunião: ${code}`);
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
      title: newTitle.trim() || "Reunião FREETING",
      roomCode: code,
      dateIso: selectedDateIso,
      startTime: newStartTime,
      endTime: "",
      hostName: "Organizador",
      status: "SCHEDULED",
      aiNotesEnabled: true,
      unlimitedRecordingEnabled: true,
      description: newDescription.trim() || "",
    };
    await persistMeetings([...meetings, created], created);
    setShowScheduleModal(false);
    announce(`Reunião ${created.title} agendada para ${created.startTime}.`);
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

  const handleCopyOrShareLink = async (text: string, useNativeShare = false) => {
    if (
      useNativeShare &&
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title: "Convite de Reunião FREETING",
          text: "Participe da nossa reunião no FREETING:",
          url: text,
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
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
      const ext = getRecordingFileExtension(rec.mimeType);
      triggerBlobDownload(
        blob,
        `freeting-${rec.roomCode}-${rec.sessionId}.${ext}`
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
    announce("Gravação excluída.");
  };

  if (activeRoomCode) {
    return (
      <MeetingRoomView
        roomCode={activeRoomCode}
        initialIsCreator={isRoomCreator}
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

  const bottomNavBgClass = isHC
    ? "bg-black border-t-2 border-yellow-400 text-white"
    : isDark
    ? "bg-[#1e1f20]/95 border-t border-[#3c4043] text-[#e3e3e3]"
    : "bg-white/95 border-t border-[#dadce0] text-[#1f1f1f]";

  return (
    <div
      className={`min-h-[100dvh] flex flex-col transition-colors duration-200 ${rootBgClass}`}
      onClick={() => {
        if (showNewMenu) setShowNewMenu(false);
      }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-[#0b57d0] focus:text-white focus:px-4 focus:py-2 focus:rounded-full focus:text-sm focus:font-semibold"
      >
        Pular para o conteúdo principal
      </a>

      <div role="status" aria-live="polite" className="sr-only">
        {a11yAnnouncement}
      </div>

      {/* TOP HEADER BAR — Adaptive Mobile & Desktop */}
      <header
        role="banner"
        className={`sticky top-0 z-30 safe-top h-14 md:h-16 px-4 flex items-center justify-between backdrop-blur-md border-b select-none ${
          isHC
            ? "bg-black border-yellow-400"
            : isDark
            ? "bg-[#131314]/95 border-[#282a2c]"
            : "bg-white/95 border-[#dadce0]/40 md:border-transparent"
        }`}
      >
        {/* Left: Clean FREETING Wordmark Logo */}
        <div className="flex items-center shrink-0">
          <svg
            width="165"
            height="30"
            viewBox="0 0 880 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="FREETING"
            className="h-6 sm:h-7 md:h-8 w-auto select-none shrink-0"
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
        </div>

        {/* Desktop Center Action Bar (Hidden on Mobile where Dedicated Touch Hero is shown) */}
        <div
          className="hidden md:flex items-center gap-2.5 justify-center"
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
              className="bg-transparent text-sm placeholder-[#5f6368] focus:outline-none w-48 lg:w-56"
            />
            <button
              type="submit"
              className={`ml-2 px-4 h-8 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                joinInput.trim()
                  ? "bg-[#0b57d0] text-white hover:bg-[#0842a0]"
                  : isDark
                  ? "bg-[#3c4043] text-[#e3e3e3] hover:bg-[#4e5256]"
                  : "bg-[#e0e2e5] text-[#5f6368] hover:bg-[#d2d5d9] hover:text-[#1f1f1f]"
              }`}
            >
              Participar
            </button>
          </form>

          {/* "+ Nova" Green Pill Button with Desktop Dropdown */}
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
                className={`hidden md:block absolute left-0 mt-2 w-72 rounded-2xl shadow-2xl py-2 z-50 ${cardBgClass}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleCreateMeetingForLater}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#0b57d0]/10 flex items-center gap-3 cursor-pointer"
                >
                  <Link2 className="w-4 h-4 text-[#0b57d0]" />
                  <div className="font-medium">
                    Criar uma reunião para depois
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleStartInstantMeeting}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#0b57d0]/10 flex items-center gap-3 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#137333]" />
                  <div className="font-medium">
                    Iniciar uma reunião instantânea
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleOpenScheduleModal}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-[#0b57d0]/10 flex items-center gap-3 cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-[#0b57d0]" />
                  <div className="font-medium">Agendar na agenda</div>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAiNotesModal(true)}
            className="h-11 px-4 rounded-full bg-[#d3e3fd] hover:bg-[#c2d7fa] text-[#041e49] text-sm font-semibold flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#0b57d0]" />
            <span className="max-w-[130px] truncate">Anotações feit...</span>
          </button>
        </div>

        {/* Right Utility Icons (40x40px minimum touch targets on mobile) */}
        <div className="flex items-center gap-1 justify-end">
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
            }}
            aria-label="Alternar tema visual"
            title="Alternar tema: Claro / Escuro / Alto Contraste"
            className="w-10 h-10 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center cursor-pointer"
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
                fontScale === 100 ? 115 : fontScale === 115 ? 130 : 100;
              setFontScale(nextScale);
              announce(`Tamanho das letras alterado para ${nextScale}%`);
            }}
            aria-label="Ajustar tamanho da fonte"
            title={`Aumentar tamanho das letras (${fontScale}%)`}
            className="px-2.5 h-9 rounded-full border border-[#dadce0] dark:border-[#3c4043] text-xs font-bold hover:bg-[#0b57d0]/10 flex items-center gap-1 cursor-pointer"
          >
            <Accessibility className="w-3.5 h-3.5 text-[#0b57d0]" />
            <span>{fontScale}%</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSecurityModal(true)}
            title="Segurança e Privacidade (LGPD)"
            aria-label="Segurança e Privacidade (LGPD)"
            className="w-10 h-10 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center opacity-80 cursor-pointer"
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            title="Configurações"
            aria-label="Configurações"
            className="w-10 h-10 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center opacity-80 cursor-pointer"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* MOBILE HERO QUICK-ACTION BAR (Shown on Smartphones < md) */}
      <section
        aria-label="Ações rápidas de reunião"
        className="md:hidden px-4 pt-3 pb-2 space-y-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setShowNewMenu(true)}
            className="h-12 px-4 rounded-2xl bg-[#c4eed0] active:bg-[#b3e5c1] text-[#0f5223] text-sm font-semibold flex items-center justify-center gap-2 shadow-2xs cursor-pointer"
          >
            <Video className="w-4 h-4 shrink-0" />
            <span>Nova reunião</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAiNotesModal(true)}
            className="h-12 px-4 rounded-2xl bg-[#d3e3fd] active:bg-[#c2d7fa] text-[#041e49] text-sm font-semibold flex items-center justify-center gap-2 shadow-2xs cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#0b57d0] shrink-0" />
            <span className="truncate">Anotações IA</span>
          </button>
        </div>

        {/* 16px font-size (text-base) prevents iOS Safari automatic input zoom! */}
        <form
          onSubmit={handleJoinRoom}
          className={`flex items-center rounded-2xl h-12 pl-3.5 pr-1.5 transition-all ${
            isHC
              ? "bg-black border-2 border-yellow-400"
              : isDark
              ? "bg-[#282a2c] focus-within:ring-2 focus-within:ring-[#8ab4f8]"
              : "bg-[#f1f3f4] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0b57d0]"
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
            placeholder="Código ou link da sala"
            aria-label="Código ou link da sala"
            className="bg-transparent text-base placeholder-[#5f6368] focus:outline-none flex-1 min-w-0"
          />
          <button
            type="submit"
            className="ml-2 px-4 h-9 rounded-xl bg-[#0b57d0] active:bg-[#0842a0] text-white text-sm font-semibold shrink-0 cursor-pointer"
          >
            Participar
          </button>
        </form>
      </section>

      {joinError && (
        <div
          role="alert"
          className="mx-4 sm:mx-auto mt-1 text-xs text-[#d93025] bg-[#fce8e6] px-4 py-2 rounded-xl text-center"
        >
          {joinError}
        </div>
      )}

      {/* BODY: DESKTOP LEFT RAIL + MAIN CONTENT */}
      <div className="flex-1 flex pb-24 md:pb-0">
        {/* Desktop Left Navigation Rail (Hidden on Mobile -> Replaced by Bottom Navigation Bar) */}
        <nav
          aria-label="Menu principal lateral"
          className="hidden md:flex w-20 pt-6 flex-col items-center gap-5 select-none shrink-0"
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
            <span className="text-[11px] font-medium">Gravações</span>
            {recordings.length > 0 && (
              <span className="absolute -top-1 right-2 bg-[#0f5223] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {recordings.length}
              </span>
            )}
          </button>
        </nav>

        {/* Main Content Container */}
        <main
          id="main-content"
          className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 pt-3 sm:pt-5 pb-12"
        >
          {activeNav === "meetings" && (
            <>
              {/* Date Strip Header — Touch-Swipeable on Mobile */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-5">
                <div className="flex items-center justify-between sm:justify-start gap-2">
                  <div className="flex items-center gap-2">
                    <h1 className="text-[1.25rem] sm:text-[1.375rem] font-normal">
                      {formatPortugueseDateHeader(selectedDate)}
                    </h1>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDate(new Date(2026, 10, 23, 12, 0, 0))
                      }
                      title="Calendário"
                      aria-label="Voltar para a data atual"
                      className="p-2 rounded-full hover:bg-[#0b57d0]/10 opacity-80 cursor-pointer"
                    >
                      <Calendar className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Mobile Compact Prev/Next Week Buttons */}
                  <div className="flex sm:hidden items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDate((d) => shiftDateByDays(d, -7))
                      }
                      aria-label="Semana anterior"
                      className="w-9 h-9 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDate((d) => shiftDateByDays(d, 7))
                      }
                      aria-label="Próxima semana"
                      className="w-9 h-9 rounded-full hover:bg-[#0b57d0]/10 flex items-center justify-center cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 7-Day Week Selector Strip (Full-width touch-friendly on mobile) */}
                <div
                  role="group"
                  aria-label="Seletor de dias da semana"
                  className="flex items-center justify-between sm:justify-end gap-1 select-none overflow-x-auto no-scrollbar py-0.5"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDate((d) => shiftDateByDays(d, -7))
                    }
                    aria-label="Semana anterior"
                    className="hidden sm:flex w-8 h-8 rounded-full hover:bg-[#0b57d0]/10 items-center justify-center cursor-pointer shrink-0"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="grid grid-cols-7 sm:flex items-center gap-1 sm:gap-2 w-full sm:w-auto">
                    {weekStrip.map((day) => (
                      <button
                        key={day.dateIso}
                        type="button"
                        aria-pressed={day.isSelected}
                        onClick={() => {
                          const [y, m, d] = day.dateIso.split("-").map(Number);
                          setSelectedDate(new Date(y, m - 1, d, 12, 0, 0));
                        }}
                        className={`min-h-[52px] sm:w-10 py-1.5 rounded-2xl sm:rounded-full flex flex-col items-center justify-center transition-all cursor-pointer ${
                          day.isSelected
                            ? "bg-[#a8c7fa] text-[#041e49] font-bold shadow-xs"
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
                    className="hidden sm:flex w-8 h-8 rounded-full hover:bg-[#0b57d0]/10 items-center justify-center cursor-pointer shrink-0"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Clean Security Banner — Responsive Card on Mobile, Pill on Desktop */}
              <div
                className={`rounded-2xl sm:rounded-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 mb-8 sm:mb-12 ${
                  isHC
                    ? "bg-black border-2 border-yellow-400 text-white"
                    : isDark
                    ? "bg-[#1b3a6b]/50 border border-[#8ab4f8]/30 text-white"
                    : "bg-[#e8f0fe] text-[#1f1f1f]"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#1a73e8] text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="text-xs sm:text-[0.8125rem] leading-snug">
                    <div className="font-semibold">Sua reunião está segura</div>
                    <div className="opacity-80">
                      As pessoas só podem participar de uma reunião se o
                      organizador convidar ou permitir
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSecurityModal(true)}
                  className="shrink-0 bg-white/90 hover:bg-white text-[#1f1f1f] border border-[#dadce0] rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                >
                  Saiba mais
                </button>
              </div>

              {/* Scheduled Meetings or Empty State Illustration */}
              {todaysMeetings.length === 0 ? (
                <div className="text-center pt-2 sm:pt-4 pb-8">
                  <FreetingEmptyIllustration />
                  <h2 className="text-[1.25rem] sm:text-[1.375rem] font-normal mt-4">
                    Nenhuma reunião agendada para hoje
                  </h2>
                  <p className="text-sm opacity-75 mt-1.5 mb-6">
                    Agende uma reunião ou aproveite seu tempo livre
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={handleStartInstantMeeting}
                      className="h-12 sm:h-11 px-6 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>Nova</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider opacity-75">
                      Reuniões agendadas ({todaysMeetings.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleOpenScheduleModal}
                      className="text-xs font-semibold text-[#0b57d0] dark:text-[#8ab4f8] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Nova reunião
                    </button>
                  </div>

                  {todaysMeetings.map((mtg) => {
                    const mtgLink = formatShareableLink(
                      mtg.roomCode,
                      typeof window !== "undefined"
                        ? window.location.origin
                        : undefined
                    );
                    return (
                      <div
                        key={mtg.id}
                        className={`hover:border-[#0b57d0] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all shadow-2xs ${cardBgClass}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="text-xs font-semibold text-[#0b57d0] bg-[#e8f0fe] px-2.5 py-0.5 rounded-full flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {mtg.startTime}
                            </span>
                          </div>
                          <h3 className="text-base font-semibold">
                            {mtg.title}
                          </h3>
                          <p className="text-xs opacity-75">
                            Código:{" "}
                            <code className="font-mono font-bold">
                              {mtg.roomCode}
                            </code>
                            {mtg.description ? ` • ${mtg.description}` : ""}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyOrShareLink(mtgLink, true)}
                            className="h-10 px-3.5 rounded-full border border-[#dadce0] hover:bg-[#0b57d0]/10 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            Compartilhar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMeeting(mtg.id)}
                            aria-label={`Excluir reunião ${mtg.title}`}
                            className="w-10 h-10 rounded-full hover:bg-[#fce8e6] text-[#d93025] flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => enterRoom(mtg.roomCode, false)}
                            className="flex-1 sm:flex-none h-10 px-5 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-semibold cursor-pointer shadow-xs"
                          >
                            Participar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeNav === "calls" && (
            <div className="py-4 sm:py-6 space-y-6">
              <div className={`rounded-3xl p-6 sm:p-8 text-center ${cardBgClass}`}>
                <div className="w-14 h-14 rounded-full bg-[#c2e7ff] text-[#001d35] flex items-center justify-center mx-auto mb-4">
                  <Phone className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-medium">Ligações</h2>
                <p className="text-sm opacity-75 max-w-md mx-auto mt-2 mb-6">
                  Inicie uma chamada de vídeo ou áudio instantaneamente no celular ou computador.
                </p>
                <div className="flex justify-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={handleStartInstantMeeting}
                    className="w-full sm:w-auto h-12 px-6 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Video className="w-4 h-4" />
                    Iniciar ligação agora
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeNav === "recordings" && (
            <div className="py-2 sm:py-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-medium flex items-center gap-2">
                    <Disc className="w-5 h-5 text-[#0f5223]" />
                    Gravações
                  </h2>
                  <p className="text-xs opacity-75 mt-0.5">
                    Assista ou baixe as gravações das suas reuniões.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStartInstantMeeting}
                  className="h-10 px-4 rounded-full bg-[#c4eed0] text-[#0f5223] text-xs font-semibold cursor-pointer"
                >
                  + Nova reunião
                </button>
              </div>

              {recordings.length === 0 ? (
                <div className="border border-dashed border-[#dadce0] rounded-2xl p-8 sm:p-10 text-center text-sm opacity-75">
                  Nenhuma gravação disponível no momento.
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
                          Sala: <code>{rec.roomCode}</code> •{" "}
                          {new Date(rec.startedAtIso).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePreviewRecording(rec)}
                          className="flex-1 sm:flex-none h-10 px-3.5 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Assistir
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadRecording(rec)}
                          className="flex-1 sm:flex-none h-10 px-4 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Baixar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecording(rec.sessionId)}
                          className="w-10 h-10 rounded-full hover:bg-[#fce8e6] text-[#d93025] flex items-center justify-center cursor-pointer"
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
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR (Material 3 Standard for Smartphones < md) */}
      <nav
        aria-label="Navegação inferior mobile"
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 safe-bottom backdrop-blur-lg ${bottomNavBgClass}`}
      >
        <div className="grid grid-cols-3 h-16 px-2">
          <button
            type="button"
            onClick={() => setActiveNav("meetings")}
            aria-current={activeNav === "meetings" ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-1 cursor-pointer"
          >
            <div
              className={`w-14 h-7 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "meetings"
                  ? "bg-[#c2e7ff] text-[#001d35]"
                  : "opacity-75"
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
            className="flex flex-col items-center justify-center gap-1 cursor-pointer"
          >
            <div
              className={`w-14 h-7 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "calls"
                  ? "bg-[#c2e7ff] text-[#001d35]"
                  : "opacity-75"
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
            className="flex flex-col items-center justify-center gap-1 cursor-pointer relative"
          >
            <div
              className={`w-14 h-7 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "recordings"
                  ? "bg-[#c4eed0] text-[#0f5223]"
                  : "opacity-75"
              }`}
            >
              <Disc className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium">Gravações</span>
            {recordings.length > 0 && (
              <span className="absolute top-1.5 right-6 bg-[#0f5223] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {recordings.length}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* MOBILE ACTION BOTTOM SHEET FOR "+ NOVA REUNIÃO" (< md) */}
      {showNewMenu && (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => setShowNewMenu(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full rounded-t-3xl p-5 safe-bottom space-y-2 animate-sheet-up ${cardBgClass}`}
          >
            <div className="w-10 h-1 rounded-full bg-[#dadce0] mx-auto mb-3" />
            <h3 className="text-base font-semibold px-2 pb-1">Nova reunião</h3>
            <button
              type="button"
              onClick={handleCreateMeetingForLater}
              className="w-full h-13 px-3 rounded-2xl hover:bg-[#0b57d0]/10 flex items-center gap-3.5 text-left text-sm font-medium cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-[#e8f0fe] text-[#0b57d0] flex items-center justify-center shrink-0">
                <Link2 className="w-5 h-5" />
              </div>
              <span>Criar uma reunião para depois</span>
            </button>
            <button
              type="button"
              onClick={handleStartInstantMeeting}
              className="w-full h-13 px-3 rounded-2xl hover:bg-[#0b57d0]/10 flex items-center gap-3.5 text-left text-sm font-medium cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-[#e6f4ea] text-[#137333] flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <span>Iniciar uma reunião instantânea</span>
            </button>
            <button
              type="button"
              onClick={handleOpenScheduleModal}
              className="w-full h-13 px-3 rounded-2xl hover:bg-[#0b57d0]/10 flex items-center gap-3.5 text-left text-sm font-medium cursor-pointer"
            >
              <div className="w-10 h-10 rounded-full bg-[#e8f0fe] text-[#0b57d0] flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <span>Agendar na agenda</span>
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Reprodutor de Vídeo de Gravação Salva */}
      {previewRecordingUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/75 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className="bg-[#1e1f20] text-white rounded-t-3xl sm:rounded-3xl max-w-3xl w-full p-5 safe-bottom shadow-2xl space-y-4 animate-sheet-up">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold truncate pr-2">
                {previewRecordingUrl.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewRecordingUrl.url);
                  setPreviewRecordingUrl(null);
                }}
                className="p-2 rounded-full hover:bg-[#282a2c] text-[#c4c7c5] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <video
              src={previewRecordingUrl.url}
              controls
              autoPlay
              playsInline
              className="w-full rounded-2xl bg-black max-h-[65dvh]"
            />
          </div>
        </div>
      )}

      {/* MODAL 1: "Veja o link da sua reunião" (Bottom Sheet on Mobile) */}
      {laterRoomCode && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 safe-bottom shadow-2xl animate-sheet-up">
            <div className="w-10 h-1 rounded-full bg-[#dadce0] mx-auto mb-3 sm:hidden" />
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">
                Veja o link da sua reunião
              </h3>
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                className="p-2 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#5f6368] mb-4">
              Copie ou compartilhe este link com as pessoas que vão participar
              da reunião.
            </p>
            <div className="bg-[#f1f3f4] rounded-xl px-3.5 py-3 flex items-center justify-between gap-2 mb-5">
              <span className="text-xs sm:text-sm font-mono truncate">
                {formatShareableLink(
                  laterRoomCode,
                  typeof window !== "undefined"
                    ? window.location.origin
                    : undefined
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyOrShareLink(
                      formatShareableLink(
                        laterRoomCode,
                        typeof window !== "undefined"
                          ? window.location.origin
                          : undefined
                      ),
                      false
                    )
                  }
                  className="p-2 rounded-full hover:bg-[#e0e2e5] cursor-pointer"
                  title="Copiar link"
                >
                  {copiedCode ? (
                    <Check className="w-4 h-4 text-[#137333]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyOrShareLink(
                      formatShareableLink(
                        laterRoomCode,
                        typeof window !== "undefined"
                          ? window.location.origin
                          : undefined
                      ),
                      true
                    )
                  }
                  className="p-2 rounded-full hover:bg-[#e0e2e5] cursor-pointer"
                  title="Compartilhar"
                >
                  <Share2 className="w-4 h-4 text-[#0b57d0]" />
                </button>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                className="h-11 px-4 rounded-full text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  const code = laterRoomCode;
                  setLaterRoomCode(null);
                  enterRoom(code, true);
                }}
                className="flex-1 sm:flex-none h-11 px-5 rounded-full bg-[#0b57d0] text-white text-sm font-semibold hover:bg-[#0842a0] cursor-pointer"
              >
                Entrar agora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Agendar Reunião (Bottom Sheet on Mobile, 16px Inputs) */}
      {showScheduleModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <form
            onSubmit={handleSaveScheduledMeeting}
            className="bg-white text-[#1f1f1f] rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up"
          >
            <div className="w-10 h-1 rounded-full bg-[#dadce0] mx-auto mb-1 sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Agendar reunião</h3>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="p-2 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
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
                placeholder="Ex: Reunião de alinhamento"
                className="w-full border border-[#dadce0] rounded-xl px-3.5 py-3 text-base sm:text-sm focus:outline-none focus:border-[#0b57d0]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] mb-1">
                  Data
                </label>
                <input
                  type="text"
                  disabled
                  value={formatPortugueseDateHeader(selectedDate)}
                  className="w-full bg-[#f1f3f4] border border-[#dadce0] rounded-xl px-3.5 py-3 text-base sm:text-sm text-[#5f6368]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5f6368] mb-1">
                  Horário
                </label>
                <input
                  type="time"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  className="w-full border border-[#dadce0] rounded-xl px-3.5 py-3 text-base sm:text-sm focus:outline-none focus:border-[#0b57d0]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5f6368] mb-1">
                Descrição (opcional)
              </label>
              <textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Adicione uma pauta para os participantes"
                className="w-full border border-[#dadce0] rounded-xl px-3.5 py-2.5 text-base sm:text-sm focus:outline-none focus:border-[#0b57d0]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="h-11 px-4 rounded-full text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 sm:flex-none h-11 px-6 rounded-full bg-[#0b57d0] text-white text-sm font-semibold hover:bg-[#0842a0] cursor-pointer"
              >
                Salvar
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
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up">
            <div className="w-10 h-1 rounded-full bg-[#dadce0] mx-auto mb-1 sm:hidden" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#d3e3fd] text-[#0b57d0] flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-medium">Anotações feitas por IA</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                className="p-2 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#444746] leading-relaxed">
              Durante suas reuniões, o assistente de IA registra automaticamente
              os principais pontos discutidos, gera resumos em português e
              organiza os próximos passos da equipe.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                className="h-11 px-4 rounded-full text-sm text-[#5f6368] hover:bg-[#f1f3f4] cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleStartInstantMeeting}
                className="flex-1 sm:flex-none h-11 px-5 rounded-full bg-[#0b57d0] text-white text-sm font-semibold hover:bg-[#0842a0] cursor-pointer"
              >
                Iniciar reunião com IA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Segurança & Central de Privacidade LGPD */}
      {showSecurityModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto animate-sheet-up">
            <div className="w-10 h-1 rounded-full bg-[#dadce0] mx-auto mb-1 sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#1a73e8] shrink-0" />
                <span>Segurança & Privacidade (LGPD)</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowSecurityModal(false);
                  setLgpdFeedback(null);
                }}
                className="p-2 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#444746] leading-relaxed">
              Em conformidade com a{" "}
              <strong>
                Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 —
                LGPD)
              </strong>
              , o FREETING aplica o princípio da minimização de dados (Art. 6º,
              III): você participa de reuniões sem cadastro obrigatório e sem
              coleta de CPF, telefone ou e-mail.
            </p>

            <div className="p-3.5 rounded-2xl bg-[#f8f9fa] border border-[#dadce0] space-y-2.5 text-xs">
              <label className="flex items-start justify-between gap-3 cursor-pointer">
                <div>
                  <div className="font-semibold text-[#1f1f1f]">
                    Proteção Automática de Dados Pessoais (Art. 5º, II e Art. 46)
                  </div>
                  <div className="text-[#5f6368]">
                    Mascarar automaticamente CPFs, e-mails e telefones digitados
                    no chat ou capturados em transcrições.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={lgpdConsent.autoMaskPersonalData}
                  onChange={(e) => {
                    const updated = saveLgpdConsent({
                      autoMaskPersonalData: e.target.checked,
                    });
                    setLgpdConsent(updated);
                  }}
                  className="mt-1 w-5 h-5 accent-[#0b57d0] shrink-0"
                />
              </label>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#e8f0fe]/60 border border-[#d3e3fd] space-y-2.5 text-xs">
              <div className="font-semibold text-[#041e49]">
                Direitos do Titular dos Dados (Art. 18 da LGPD)
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleExportLgpdDataPortability}
                  className="h-10 px-3.5 rounded-full bg-white hover:bg-[#f1f3f4] text-[#0b57d0] border border-[#dadce0] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar Meus Dados
                </button>
                <button
                  type="button"
                  onClick={handleEraseAllPersonalDataLgpd}
                  className="h-10 px-3.5 rounded-full bg-[#fce8e6] hover:bg-[#fad2cf] text-[#c5221f] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar Todos os Dados
                </button>
              </div>
              {lgpdFeedback && (
                <div className="text-[11px] font-medium text-[#137333] pt-1">
                  ✓ {lgpdFeedback}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const updated = saveLgpdConsent({
                    acceptedPrivacyNotice: true,
                  });
                  setLgpdConsent(updated);
                  setShowSecurityModal(false);
                  setLgpdFeedback(null);
                }}
                className="w-full sm:w-auto h-11 px-6 rounded-full bg-[#0b57d0] text-white text-sm font-semibold cursor-pointer"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BANNER DISCRETO DE TRANSPARÊNCIA E CONSENTIMENTO LGPD (Acima da barra mobile) */}
      {!lgpdConsent.acceptedPrivacyNotice && (
        <div
          role="region"
          aria-label="Aviso de Privacidade e LGPD"
          className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-[92%] bg-[#1e1f20] text-white rounded-2xl px-4 sm:px-5 py-3.5 shadow-2xl border border-[#3c4043] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
        >
          <div className="leading-relaxed text-[#e3e3e3]">
            <strong className="text-white">Privacidade & LGPD:</strong> O
            FREETING não coleta cadastro pessoal e mantém suas gravações sob seu
            controle exclusivo no dispositivo.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSecurityModal(true)}
              className="flex-1 sm:flex-none h-9 px-3.5 rounded-full border border-[#8e918f] hover:bg-[#282a2c] text-white font-medium cursor-pointer"
            >
              Direitos LGPD
            </button>
            <button
              type="button"
              onClick={() => {
                const updated = saveLgpdConsent({
                  acceptedPrivacyNotice: true,
                });
                setLgpdConsent(updated);
              }}
              className="flex-1 sm:flex-none h-9 px-4 rounded-full bg-[#a8c7fa] hover:bg-[#8ab4f8] text-[#041e49] font-semibold cursor-pointer"
            >
              Concordar
            </button>
          </div>
        </div>
      )}

      {/* MODAL 5: Configurações de Áudio e Vídeo */}
      {showSettingsModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className="bg-white text-[#1f1f1f] rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up">
            <div className="w-10 h-1 rounded-full bg-[#dadce0] mx-auto mb-1 sm:hidden" />
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#5f6368]" />
                Configurações
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-2 rounded-full hover:bg-[#f1f3f4] text-[#5f6368] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="p-3.5 rounded-xl bg-[#f8f9fa] border border-[#dadce0] flex items-center gap-3">
                <Mic className="w-5 h-5 text-[#0b57d0]" />
                <div>
                  <div className="font-medium">Microfone</div>
                  <div className="text-xs text-[#5f6368]">
                    Padrão do sistema
                  </div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#f8f9fa] border border-[#dadce0] flex items-center gap-3">
                <Camera className="w-5 h-5 text-[#0b57d0]" />
                <div>
                  <div className="font-medium">Vídeo</div>
                  <div className="text-xs text-[#5f6368]">
                    Alta definição (720p)
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="w-full sm:w-auto h-11 px-6 rounded-full bg-[#0b57d0] text-white text-sm font-semibold cursor-pointer"
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
