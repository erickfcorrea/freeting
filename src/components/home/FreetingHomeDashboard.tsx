"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Keyboard,
  Video,
  Sparkles,
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
  ClipboardPaste,
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
const STORAGE_THEME_KEY = "freeting_app_theme_v4";
const STORAGE_FONT_SCALE_KEY = "freeting_font_scale_v1";

export type HomeThemeMode = "light" | "dark" | "high-contrast";

export function FreetingHomeDashboard() {
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [isRoomCreator, setIsRoomCreator] = useState<boolean>(false);

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<
    "meetings" | "calls" | "recordings"
  >("meetings");

  // UI Theme & WCAG Accessibility Preferences
  const [theme, setTheme] = useState<HomeThemeMode>("light");
  const [fontScale, setFontScale] = useState<100 | 115 | 130>(100);
  const [a11yAnnouncement, setA11yAnnouncement] = useState(
    "Painel do FREETING carregado.",
  );

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(
        STORAGE_THEME_KEY,
      ) as HomeThemeMode | null;
      if (
        savedTheme === "light" ||
        savedTheme === "dark" ||
        savedTheme === "high-contrast"
      ) {
        setTheme(savedTheme);
      }
      const savedScale = Number(localStorage.getItem(STORAGE_FONT_SCALE_KEY));
      if (savedScale === 100 || savedScale === 115 || savedScale === 130) {
        setFontScale(savedScale);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.freetingTheme = theme;
      document.documentElement.style.fontSize = `${fontScale}%`;
    }
    try {
      localStorage.setItem(STORAGE_THEME_KEY, theme);
      localStorage.setItem(STORAGE_FONT_SCALE_KEY, String(fontScale));
    } catch {
      // ignore
    }
  }, [theme, fontScale]);

  // Modals
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
              validateAndSanitizeMeetingInput(item, generateRoomCode()),
            )
            .filter((item): item is NonNullable<typeof item> => item !== null);
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
            mergedMap.set(m.id, m),
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
      "Arquivo de portabilidade de dados (JSON) exportado com sucesso.",
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
      "Todos os agendamentos e gravações foram permanentemente eliminados (Art. 18, VI da LGPD).",
    );
  };

  const persistMeetings = async (
    next: ScheduledMeeting[],
    createdItem?: ScheduledMeeting,
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

  const weekStrip = buildWeekStrip(selectedDate, new Date());
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
        "Digite um código válido (ex: amd-wraw-qkg) ou cole o link da reunião.",
      );
      announce("Erro: código de sala inválido.");
      return;
    }
    setJoinError(null);
    announce(`Preparando para entrar na sala ${extracted}`);
    enterRoom(extracted, false);
  };

  const handlePasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setJoinInput(text.trim());
        setJoinError(null);
        announce("Código colado da área de transferência.");
      }
    } catch {
      // ignore
    }
  };

  const handleStartInstantMeeting = () => {
    const code = generateRoomCode();
    announce(`Iniciando reunião instantânea ${code}`);
    enterRoom(code, true);
  };

  const handleCreateMeetingForLater = () => {
    const code = generateRoomCode();
    setLaterRoomCode(code);
    setCopiedCode(false);
    announce(`Link criado para reunião: ${code}`);
  };

  const handleOpenScheduleModal = () => {
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

  const handleCopyOrShareLink = async (
    text: string,
    useNativeShare = false,
  ) => {
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
      rec.mimeType,
    );
    if (blob) {
      const ext = getRecordingFileExtension(rec.mimeType);
      triggerBlobDownload(
        blob,
        `freeting-${rec.roomCode}-${rec.sessionId}.${ext}`,
      );
      announce(`Baixando gravação da sala ${rec.roomCode}`);
    }
  };

  const handlePreviewRecording = async (rec: StoredRecordingMeta) => {
    const blob = await assembleRecordingBlobFromVault(
      rec.sessionId,
      rec.mimeType,
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
      ? "bg-[#0D1016] text-[#F1F5F9]"
      : "bg-[#F5F7FA] text-[#0F172A]";

  const cardClass = isHC
    ? "bg-black border-2 border-yellow-400 text-white"
    : isDark
      ? "bg-[#151A23] ring-1 ring-white/[0.08] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] text-[#F1F5F9]"
      : "bg-white ring-1 ring-slate-900/[0.07] shadow-[0_14px_34px_-18px_rgba(15,23,42,0.12)] text-[#0F172A]";

  const subtleBoxClass = isHC
    ? "bg-black border border-yellow-400 text-white"
    : isDark
      ? "bg-[#0D1016] ring-1 ring-white/[0.07] text-[#F1F5F9]"
      : "bg-[#F1F5F9] ring-1 ring-slate-900/[0.06] text-[#0F172A]";

  const mutedClass = isHC
    ? "text-yellow-200"
    : isDark
      ? "text-slate-400"
      : "text-slate-600";

  const primaryActionClass = isHC
    ? "bg-yellow-400 text-black font-extrabold hover:bg-yellow-300"
    : "bg-[#0D9488] hover:bg-[#0F766E] text-white font-semibold shadow-sm";

  return (
    <div className={`min-h-[100dvh] flex flex-col transition-colors duration-200 ${rootBgClass}`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2.5 focus:left-2.5 focus:z-50 focus:bg-[#0D9488] focus:text-white focus:px-4 focus:py-2 focus:rounded-xl focus:text-sm focus:font-semibold"
      >
        Pular para o conteúdo principal
      </a>

      <div role="status" aria-live="polite" className="sr-only">
        {a11yAnnouncement}
      </div>

      {/* ======================================================================
          TOP HEADER BAR — Original FREETING Wordmark + Segmented Nav + A11y
         ====================================================================== */}
      <header
        role="banner"
        className={`sticky top-0 z-30 safe-top backdrop-blur-md border-b select-none ${
          isHC
            ? "bg-black border-yellow-400"
            : isDark
              ? "bg-[#0D1016]/92 border-white/[0.07]"
              : "bg-white/92 border-slate-200/80"
        }`}
      >
        <div className="max-w-6xl mx-auto h-15 sm:h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Original Clean Engraved FREETING Wordmark (Zero icon box in front) */}
          <button
            type="button"
            onClick={() => setActiveNav("meetings")}
            aria-label="FREETING — Início"
            className="flex items-center shrink-0 cursor-pointer"
          >
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
          </button>

          {/* Desktop Center Segmented Navigation (Replaces vertical clone rail) */}
          <nav
            aria-label="Navegação principal"
            className={`hidden md:flex items-center gap-1 rounded-2xl p-1 ${subtleBoxClass}`}
          >
            {(
              [
                { id: "meetings", label: "Reuniões", icon: Calendar },
                { id: "calls", label: "Ligações", icon: Phone },
                {
                  id: "recordings",
                  label: `Gravações${recordings.length ? ` (${recordings.length})` : ""}`,
                  icon: Disc,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeNav === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    setActiveNav(tab.id);
                    if (tab.id === "recordings") refreshRecordings();
                  }}
                  className={`h-9 px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition cursor-pointer ${
                    isActive ? primaryActionClass : "opacity-80 hover:opacity-100"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Accessibility & Settings Controls */}
          <div className="flex items-center gap-1.5 justify-end shrink-0">
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
                const label =
                  nextTheme === "light"
                    ? "Claro"
                    : nextTheme === "dark"
                      ? "Escuro"
                      : "Alto Contraste";
                announce(`Tema alterado para ${label}`);
              }}
              aria-label="Alternar tema visual: Claro, Escuro ou Alto Contraste"
              title="Tema: Claro / Escuro / Alto Contraste"
              className={`h-10 px-2.5 sm:px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${subtleBoxClass}`}
            >
              {theme === "light" && <Sun className="w-4 h-4 text-amber-600" />}
              {theme === "dark" && <Moon className="w-4 h-4 text-teal-400" />}
              {theme === "high-contrast" && (
                <Contrast className="w-4 h-4 text-yellow-300" />
              )}
              <span className="hidden sm:inline">
                {theme === "light"
                  ? "Claro"
                  : theme === "dark"
                    ? "Escuro"
                    : "Contraste"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const nextScale =
                  fontScale === 100 ? 115 : fontScale === 115 ? 130 : 100;
                setFontScale(nextScale);
                announce(`Tamanho do texto alterado para ${nextScale}%`);
              }}
              aria-label={`Tamanho do texto ${fontScale}%. Clique para ajustar`}
              title={`Tamanho do texto (${fontScale}%)`}
              className={`h-10 px-2.5 rounded-xl font-mono-tabular text-xs font-bold inline-flex items-center gap-1 cursor-pointer ${subtleBoxClass}`}
            >
              <Accessibility
                className={`w-4 h-4 ${
                  isHC ? "text-yellow-300" : "text-[#0D9488]"
                }`}
              />
              <span>{fontScale}%</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSecurityModal(true)}
              title="Segurança e Privacidade (LGPD)"
              aria-label="Segurança e Privacidade (LGPD)"
              className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
            >
              <ShieldCheck
                className={`w-4 h-4 ${
                  isHC ? "text-yellow-300" : "text-[#0D9488]"
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              title="Configurações"
              aria-label="Configurações"
              className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
            >
              <Settings className="w-4 h-4 opacity-85" />
            </button>
          </div>
        </div>
      </header>

      {/* ======================================================================
          MAIN FUNCTIONAL WORKSPACE (Zero Landing Page / Direct App Controls)
         ====================================================================== */}
      <main
        id="main-content"
        className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-5 sm:pt-7 pb-24 md:pb-12"
      >
        {activeNav === "meetings" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
            {/* LEFT PANEL (lg:col-span-5): Direct Start & Join Controls */}
            <section
              aria-label="Iniciar ou participar de uma reunião"
              className={`lg:col-span-5 rounded-[24px] p-5 sm:p-6 space-y-4 ${cardClass}`}
            >
              {/* Primary Action: Instant Meeting */}
              <button
                type="button"
                onClick={handleStartInstantMeeting}
                className={`w-full min-h-[52px] px-5 rounded-2xl text-sm inline-flex items-center justify-center gap-2.5 transition active:scale-[0.99] cursor-pointer ${primaryActionClass}`}
              >
                <Video className="w-5 h-5 shrink-0" />
                <span>Nova reunião instantânea</span>
              </button>

              {/* Secondary Direct Actions */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={handleCreateMeetingForLater}
                  className={`min-h-[56px] px-2.5 py-2 rounded-2xl text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition hover:opacity-90 cursor-pointer ${subtleBoxClass}`}
                >
                  <Link2
                    className={`w-4 h-4 ${
                      isHC ? "text-yellow-300" : "text-[#0D9488]"
                    }`}
                  />
                  <span className="text-center leading-tight">Criar link</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenScheduleModal}
                  className={`min-h-[56px] px-2.5 py-2 rounded-2xl text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition hover:opacity-90 cursor-pointer ${subtleBoxClass}`}
                >
                  <Calendar
                    className={`w-4 h-4 ${
                      isHC ? "text-yellow-300" : "text-[#0D9488]"
                    }`}
                  />
                  <span className="text-center leading-tight">Agendar</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAiNotesModal(true)}
                  className={`min-h-[56px] px-2.5 py-2 rounded-2xl text-xs font-semibold flex flex-col items-center justify-center gap-1.5 transition hover:opacity-90 cursor-pointer ${subtleBoxClass}`}
                >
                  <Sparkles
                    className={`w-4 h-4 ${
                      isHC ? "text-yellow-300" : "text-amber-500"
                    }`}
                  />
                  <span className="text-center leading-tight">Notas IA</span>
                </button>
              </div>

              {/* Join Existing Room by Code or Link */}
              <form
                onSubmit={handleJoinRoom}
                role="search"
                aria-label="Entrar com código ou link"
                className="space-y-2 pt-1"
              >
                <div
                  className={`flex items-center rounded-2xl min-h-[50px] pl-3.5 pr-1.5 ${subtleBoxClass}`}
                >
                  <Keyboard className={`w-4 h-4 mr-2.5 shrink-0 ${mutedClass}`} />
                  <input
                    type="text"
                    value={joinInput}
                    onChange={(e) => {
                      setJoinInput(e.target.value);
                      if (joinError) setJoinError(null);
                    }}
                    placeholder="Código ou link da reunião"
                    aria-label="Digite um código ou link da reunião"
                    className="bg-transparent font-mono-tabular text-base sm:text-sm focus:outline-none flex-1 min-w-0 placeholder:font-sans placeholder:opacity-65"
                  />
                  <button
                    type="button"
                    onClick={handlePasteCode}
                    title="Colar código ou link"
                    aria-label="Colar código da área de transferência"
                    className="h-9 w-9 rounded-xl flex items-center justify-center opacity-75 hover:opacity-100 cursor-pointer shrink-0"
                  >
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                  <button
                    type="submit"
                    className={`ml-1 h-9 px-4 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                      joinInput.trim()
                        ? primaryActionClass
                        : `${cardClass} opacity-85 hover:opacity-100`
                    }`}
                  >
                    Participar
                  </button>
                </div>

                {joinError && (
                  <div
                    role="alert"
                    className="rounded-xl bg-rose-500/15 ring-1 ring-rose-500/35 px-3.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-300"
                  >
                    {joinError}
                  </div>
                )}
              </form>

              {/* Discrete Security Notice */}
              <div
                className={`rounded-2xl px-3.5 py-3 flex items-center justify-between gap-3 text-xs ${subtleBoxClass}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${
                      isHC ? "text-yellow-300" : "text-[#0D9488]"
                    }`}
                  />
                  <span className={`leading-snug ${mutedClass}`}>
                    Sem limite de tempo e sem cadastro obrigatório.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSecurityModal(true)}
                  className="shrink-0 font-semibold underline underline-offset-2 cursor-pointer"
                >
                  LGPD
                </button>
              </div>
            </section>

            {/* RIGHT PANEL (lg:col-span-7): Calendar Strip & Today's Schedule */}
            <section
              aria-label="Agenda de reuniões"
              className={`lg:col-span-7 rounded-[24px] p-5 sm:p-6 space-y-5 ${cardClass}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center justify-between sm:justify-start gap-2.5">
                  <h1 className="text-lg sm:text-xl font-bold capitalize">
                    {formatPortugueseDateHeader(selectedDate)}
                  </h1>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(new Date())}
                    title="Voltar para hoje"
                    className={`h-8 px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${subtleBoxClass}`}
                  >
                    Hoje
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDate((d) => shiftDateByDays(d, -7))
                    }
                    aria-label="Semana anterior"
                    className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDate((d) => shiftDateByDays(d, 7))
                    }
                    aria-label="Próxima semana"
                    className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 7-Day Week Selector */}
              <div
                role="group"
                aria-label="Seletor de dias da semana"
                className="grid grid-cols-7 gap-1.5 select-none"
              >
                {weekStrip.map((day) => (
                  <button
                    key={day.dateIso}
                    type="button"
                    aria-pressed={day.isSelected}
                    onClick={() => {
                      const [y, m, d] = day.dateIso.split("-").map(Number);
                      setSelectedDate(new Date(y, m - 1, d, 12, 0, 0));
                    }}
                    className={`min-h-[54px] py-1.5 rounded-2xl flex flex-col items-center justify-center transition cursor-pointer ${
                      day.isSelected
                        ? primaryActionClass
                        : `${subtleBoxClass} opacity-85 hover:opacity-100`
                    }`}
                  >
                    <span className="text-[10px] tracking-wider uppercase font-semibold leading-tight">
                      {day.dayOfWeekShort}
                    </span>
                    <span className="font-mono-tabular text-sm font-bold leading-tight mt-0.5">
                      {day.dayNumber}
                    </span>
                  </button>
                ))}
              </div>

              {/* Scheduled Meetings or Clean Empty State */}
              {todaysMeetings.length === 0 ? (
                <div
                  className={`rounded-2xl py-8 px-4 text-center space-y-3 ${subtleBoxClass}`}
                >
                  <FreetingEmptyIllustration />
                  <div>
                    <h2 className="text-base font-semibold">
                      Nenhuma reunião agendada para esta data
                    </h2>
                    <p className={`text-xs mt-1 ${mutedClass}`}>
                      Você pode iniciar uma sala agora ou agendar um horário.
                    </p>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleOpenScheduleModal}
                      className={`h-10 px-4 rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer ${primaryActionClass}`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>Agendar horário</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${mutedClass}`}>
                      Agendadas ({todaysMeetings.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleOpenScheduleModal}
                      className="text-xs font-semibold text-[#0D9488] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar
                    </button>
                  </div>

                  {todaysMeetings.map((mtg) => {
                    const mtgLink = formatShareableLink(
                      mtg.roomCode,
                      typeof window !== "undefined"
                        ? window.location.origin
                        : undefined,
                    );
                    return (
                      <div
                        key={mtg.id}
                        className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 ${subtleBoxClass}`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono-tabular text-xs font-bold text-[#0D9488] bg-[#0D9488]/12 px-2.5 py-0.5 rounded-lg inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {mtg.startTime}
                            </span>
                            <code className="font-mono-tabular text-xs font-semibold opacity-80">
                              {mtg.roomCode}
                            </code>
                          </div>
                          <h3 className="text-sm sm:text-base font-semibold truncate">
                            {mtg.title}
                          </h3>
                          {mtg.description && (
                            <p className={`text-xs truncate ${mutedClass}`}>
                              {mtg.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyOrShareLink(mtgLink, true)}
                            className={`h-10 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${cardClass}`}
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Compartilhar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMeeting(mtg.id)}
                            aria-label={`Excluir reunião ${mtg.title}`}
                            className="w-10 h-10 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => enterRoom(mtg.roomCode, false)}
                            className={`flex-1 sm:flex-none h-10 px-5 rounded-xl text-xs sm:text-sm cursor-pointer ${primaryActionClass}`}
                          >
                            Participar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {activeNav === "calls" && (
          <div className="max-w-xl mx-auto py-4">
            <div className={`rounded-[24px] p-6 sm:p-8 text-center space-y-4 ${cardClass}`}>
              <div className="w-14 h-14 rounded-2xl bg-[#0D9488]/15 text-[#0D9488] flex items-center justify-center mx-auto">
                <Phone className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold">Ligações diretas</h2>
              <p className={`text-sm max-w-md mx-auto ${mutedClass}`}>
                Inicie uma chamada de vídeo ou áudio instantaneamente e envie o link para quem quiser chamar.
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleStartInstantMeeting}
                  className={`w-full sm:w-auto h-12 px-6 rounded-2xl text-sm inline-flex items-center justify-center gap-2 cursor-pointer ${primaryActionClass}`}
                >
                  <Video className="w-4 h-4" />
                  <span>Iniciar ligação agora</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeNav === "recordings" && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Disc className="w-5 h-5 text-[#0D9488]" />
                  <span>Gravações salvas ({recordings.length})</span>
                </h2>
                <p className={`text-xs mt-0.5 ${mutedClass}`}>
                  Armazenadas localmente no seu navegador, prontas para assistir ou baixar.
                </p>
              </div>
              <button
                type="button"
                onClick={handleStartInstantMeeting}
                className={`h-10 px-4 rounded-xl text-xs cursor-pointer ${primaryActionClass}`}
              >
                + Nova reunião
              </button>
            </div>

            {recordings.length === 0 ? (
              <div className={`rounded-[24px] p-10 text-center text-sm ${cardClass}`}>
                <p className={mutedClass}>Nenhuma gravação disponível no momento.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recordings.map((rec) => (
                  <div
                    key={rec.sessionId}
                    className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${cardClass}`}
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{rec.title}</span>
                        <span className="font-mono-tabular text-xs bg-[#0D9488]/15 text-[#0D9488] px-2.5 py-0.5 rounded-lg font-semibold">
                          {formatUnlimitedDuration(rec.durationSeconds)} ·{" "}
                          {formatRecordingBytes(rec.totalBytes)}
                        </span>
                      </div>
                      <div className={`font-mono-tabular text-xs mt-1 ${mutedClass}`}>
                        Sala: <code>{rec.roomCode}</code> ·{" "}
                        {new Date(rec.startedAtIso).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePreviewRecording(rec)}
                        className={`flex-1 sm:flex-none h-10 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${subtleBoxClass}`}
                      >
                        <Play className="w-3.5 h-3.5 text-[#0D9488]" />
                        <span>Assistir</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadRecording(rec)}
                        className={`flex-1 sm:flex-none h-10 px-4 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer ${primaryActionClass}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Baixar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRecording(rec.sessionId)}
                        aria-label={`Excluir gravação ${rec.title}`}
                        className="w-10 h-10 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center cursor-pointer"
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

      {/* ======================================================================
          MOBILE BOTTOM NAVIGATION BAR (< md)
         ====================================================================== */}
      <nav
        aria-label="Navegação inferior mobile"
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 safe-bottom backdrop-blur-lg border-t ${
          isHC
            ? "bg-black border-yellow-400"
            : isDark
              ? "bg-[#151A23]/95 border-white/10"
              : "bg-white/95 border-slate-200"
        }`}
      >
        <div className="grid grid-cols-3 h-16 px-2">
          <button
            type="button"
            onClick={() => setActiveNav("meetings")}
            aria-current={activeNav === "meetings" ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-1 cursor-pointer"
          >
            <div
              className={`w-12 h-7 rounded-xl flex items-center justify-center transition-colors ${
                activeNav === "meetings" ? primaryActionClass : "opacity-75"
              }`}
            >
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-semibold">Reuniões</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav("calls")}
            aria-current={activeNav === "calls" ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-1 cursor-pointer"
          >
            <div
              className={`w-12 h-7 rounded-xl flex items-center justify-center transition-colors ${
                activeNav === "calls" ? primaryActionClass : "opacity-75"
              }`}
            >
              <Phone className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-semibold">Ligações</span>
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
              className={`w-12 h-7 rounded-xl flex items-center justify-center transition-colors ${
                activeNav === "recordings" ? primaryActionClass : "opacity-75"
              }`}
            >
              <Disc className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-semibold">Gravações</span>
            {recordings.length > 0 && (
              <span className="absolute top-1.5 right-6 bg-[#0D9488] text-white font-mono-tabular text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {recordings.length}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* ======================================================================
          MODALS
         ====================================================================== */}
      {previewRecordingUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/75 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-3xl w-full p-5 safe-bottom shadow-2xl space-y-4 animate-sheet-up ${cardClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold truncate pr-2">
                {previewRecordingUrl.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewRecordingUrl.url);
                  setPreviewRecordingUrl(null);
                }}
                aria-label="Fechar vídeo"
                className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
              >
                <X className="w-4 h-4" />
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

      {laterRoomCode && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 safe-bottom shadow-2xl animate-sheet-up ${cardClass}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Link da sua reunião</h3>
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                aria-label="Fechar janela"
                className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className={`text-sm mb-4 ${mutedClass}`}>
              Copie ou compartilhe este link com quem vai participar.
            </p>
            <div className={`rounded-xl px-3.5 py-3 flex items-center justify-between gap-2 mb-5 ${subtleBoxClass}`}>
              <span className="font-mono-tabular text-xs sm:text-sm truncate">
                {formatShareableLink(
                  laterRoomCode,
                  typeof window !== "undefined"
                    ? window.location.origin
                    : undefined,
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
                          : undefined,
                      ),
                      false,
                    )
                  }
                  className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  title="Copiar link"
                >
                  {copiedCode ? (
                    <Check className="w-4 h-4 text-[#0D9488]" />
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
                          : undefined,
                      ),
                      true,
                    )
                  }
                  className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  title="Compartilhar"
                >
                  <Share2 className="w-4 h-4 text-[#0D9488]" />
                </button>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                className={`h-11 px-4 rounded-xl text-sm font-semibold cursor-pointer ${subtleBoxClass}`}
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
                className={`flex-1 sm:flex-none h-11 px-5 rounded-xl text-sm cursor-pointer ${primaryActionClass}`}
              >
                Entrar agora
              </button>
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <form
            onSubmit={handleSaveScheduledMeeting}
            className={`rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up ${cardClass}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Agendar reunião</h3>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                aria-label="Fechar janela"
                className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className={`block text-xs font-semibold mb-1 ${mutedClass}`}>
                Título da reunião
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Alinhamento semanal"
                className={`w-full rounded-xl px-3.5 py-3 text-base sm:text-sm focus:outline-none ${subtleBoxClass}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-xs font-semibold mb-1 ${mutedClass}`}>
                  Data
                </label>
                <input
                  type="text"
                  disabled
                  value={formatPortugueseDateHeader(selectedDate)}
                  className={`w-full rounded-xl px-3.5 py-3 text-base sm:text-sm opacity-75 ${subtleBoxClass}`}
                />
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1 ${mutedClass}`}>
                  Horário
                </label>
                <input
                  type="time"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-3 font-mono-tabular text-base sm:text-sm focus:outline-none ${subtleBoxClass}`}
                />
              </div>
            </div>
            <div>
              <label className={`block text-xs font-semibold mb-1 ${mutedClass}`}>
                Descrição (opcional)
              </label>
              <textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Adicione uma pauta para os participantes"
                className={`w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm focus:outline-none ${subtleBoxClass}`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className={`h-11 px-4 rounded-xl text-sm font-semibold cursor-pointer ${subtleBoxClass}`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={`flex-1 sm:flex-none h-11 px-6 rounded-xl text-sm cursor-pointer ${primaryActionClass}`}
              >
                Salvar
              </button>
            </div>
          </form>
        </div>
      )}

      {showAiNotesModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up ${cardClass}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold">Anotações por IA</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                aria-label="Fechar janela"
                className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className={`text-sm leading-relaxed ${mutedClass}`}>
              Durante suas reuniões, o assistente de IA registra os principais pontos discutidos, gera resumos em português e permite baixar a ata completa.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                className={`h-11 px-4 rounded-xl text-sm font-semibold cursor-pointer ${subtleBoxClass}`}
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleStartInstantMeeting}
                className={`flex-1 sm:flex-none h-11 px-5 rounded-xl text-sm cursor-pointer ${primaryActionClass}`}
              >
                Iniciar reunião
              </button>
            </div>
          </div>
        </div>
      )}

      {showSecurityModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto animate-sheet-up ${cardClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#0D9488] shrink-0" />
                <span>Segurança & Privacidade (LGPD)</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowSecurityModal(false);
                  setLgpdFeedback(null);
                }}
                aria-label="Fechar janela"
                className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className={`text-xs leading-relaxed ${mutedClass}`}>
              Em conformidade com a <strong>Lei nº 13.709/2018 (LGPD)</strong>, você participa de reuniões sem cadastro obrigatório e sem coleta de CPF, telefone ou e-mail.
            </p>

            <div className={`p-3.5 rounded-2xl space-y-2.5 text-xs ${subtleBoxClass}`}>
              <label className="flex items-start justify-between gap-3 cursor-pointer">
                <div>
                  <div className="font-semibold">
                    Proteção Automática de Dados Pessoais (Art. 5º e Art. 46)
                  </div>
                  <div className={mutedClass}>
                    Mascarar automaticamente CPFs, e-mails e telefones digitados no chat ou nas transcrições.
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
                  className="mt-1 w-5 h-5 accent-[#0D9488] shrink-0"
                />
              </label>
            </div>

            <div className={`p-3.5 rounded-2xl space-y-2.5 text-xs ${subtleBoxClass}`}>
              <div className="font-semibold">
                Direitos do Titular dos Dados (Art. 18 da LGPD)
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleExportLgpdDataPortability}
                  className={`h-10 px-3.5 rounded-xl font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${cardClass}`}
                >
                  <Download className="w-3.5 h-3.5 text-[#0D9488]" />
                  Exportar Meus Dados
                </button>
                <button
                  type="button"
                  onClick={handleEraseAllPersonalDataLgpd}
                  className="h-10 px-3.5 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar Todos os Dados
                </button>
              </div>
              {lgpdFeedback && (
                <div className="text-[11px] font-semibold text-[#0D9488] pt-1">
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
                className={`w-full sm:w-auto h-11 px-6 rounded-xl text-sm cursor-pointer ${primaryActionClass}`}
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {!lgpdConsent.acceptedPrivacyNotice && (
        <div
          role="region"
          aria-label="Aviso de Privacidade e LGPD"
          className={`fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-[92%] rounded-2xl px-4 sm:px-5 py-3.5 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${cardClass}`}
        >
          <div className="leading-relaxed">
            <strong>Privacidade & LGPD:</strong> O FREETING não coleta cadastro pessoal e mantém suas gravações exclusivamente no seu dispositivo.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSecurityModal(true)}
              className={`flex-1 sm:flex-none h-9 px-3.5 rounded-xl font-semibold cursor-pointer ${subtleBoxClass}`}
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
              className={`flex-1 sm:flex-none h-9 px-4 rounded-xl cursor-pointer ${primaryActionClass}`}
            >
              Concordar
            </button>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 safe-bottom shadow-2xl space-y-4 animate-sheet-up ${cardClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#0D9488]" />
                <span>Configurações</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                aria-label="Fechar configurações"
                className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${subtleBoxClass}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className={`p-3.5 rounded-xl flex items-center gap-3 ${subtleBoxClass}`}>
                <Mic className="w-5 h-5 text-[#0D9488]" />
                <div>
                  <div className="font-semibold">Microfone</div>
                  <div className={`text-xs ${mutedClass}`}>
                    Padrão do sistema (ajustável na sala)
                  </div>
                </div>
              </div>
              <div className={`p-3.5 rounded-xl flex items-center gap-3 ${subtleBoxClass}`}>
                <Camera className="w-5 h-5 text-[#0D9488]" />
                <div>
                  <div className="font-semibold">Vídeo</div>
                  <div className={`text-xs ${mutedClass}`}>
                    Alta definição adaptativa
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className={`w-full sm:w-auto h-11 px-6 rounded-xl text-sm cursor-pointer ${primaryActionClass}`}
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
