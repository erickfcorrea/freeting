"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Video,
  Sparkles,
  Settings,
  Calendar,
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
  ArrowRight,
  ClipboardPaste,
  Radio,
  Layers,
  Lock,
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
import { FreetingStudioDemoReel } from "./FreetingStudioDemoReel";
import { MeetingRoomView } from "../room/MeetingRoomView";

const STORAGE_MEETINGS_KEY = "freeting_scheduled_meetings_v2";
const STORAGE_STUDIO_THEME_KEY = "freeting_studio_theme_v3";
const STORAGE_FONT_SCALE_KEY = "freeting_font_scale_v1";

export type HomeThemeMode = "dark" | "light" | "high-contrast";
type StudioSectionTab = "studio" | "demo" | "agenda" | "vault";

export function FreetingHomeDashboard() {
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [isRoomCreator, setIsRoomCreator] = useState<boolean>(false);

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<StudioSectionTab>("studio");

  // Studio Theme & WCAG Accessibility Preferences (Default: Signature Obsidian Studio Dark)
  const [theme, setTheme] = useState<HomeThemeMode>("dark");
  const [fontScale, setFontScale] = useState<100 | 115 | 130>(100);
  const [a11yAnnouncement, setA11yAnnouncement] = useState(
    "Estúdio FREETING carregado. Sem limite de tempo e sem login obrigatório.",
  );

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(
        STORAGE_STUDIO_THEME_KEY,
      ) as HomeThemeMode | null;
      if (
        savedTheme === "dark" ||
        savedTheme === "light" ||
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
      localStorage.setItem(STORAGE_STUDIO_THEME_KEY, theme);
      localStorage.setItem(STORAGE_FONT_SCALE_KEY, String(fontScale));
    } catch {
      // ignore
    }
  }, [theme, fontScale]);

  // Modals & Drawers
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
      announce(`Abrindo estúdio instantâneo ${instantCode}`);
      enterRoom(instantCode, true);
      return;
    }
    const extracted = extractRoomCode(joinInput);
    if (!extracted) {
      setJoinError(
        "Formato inválido. Digite um código como abc-defg-hij ou cole o link completo.",
      );
      announce("Erro: código de sala inválido.");
      return;
    }
    setJoinError(null);
    announce(`Entrando no camarim da sala ${extracted}`);
    enterRoom(extracted, false);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setJoinInput(text.trim());
        setJoinError(null);
        announce("Código ou link colado da área de transferência.");
      }
    } catch {
      announce("Permissão da área de transferência não concedida.");
    }
  };

  const handleStartInstantMeeting = () => {
    const code = generateRoomCode();
    announce(`Iniciando estúdio instantâneo ${code}`);
    enterRoom(code, true);
  };

  const handleCreateMeetingForLater = () => {
    const code = generateRoomCode();
    setLaterRoomCode(code);
    setCopiedCode(false);
    announce(`Link de estúdio criado: ${code}`);
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
      title: newTitle.trim() || "Sessão FREETING Studio",
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
    announce(`Sessão ${created.title} agendada para ${created.startTime}.`);
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
    announce("Sessão removida da agenda.");
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
          title: "Convite de Sala FREETING Studio",
          text: "Entre direto na nossa sala sem precisar de conta:",
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
    announce("Gravação excluída do cofre local.");
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

  const isLight = theme === "light";
  const isHC = theme === "high-contrast";

  const rootShellClass = isHC
    ? "bg-black text-white"
    : isLight
      ? "studio-atmosphere-light text-[#0F1419]"
      : "studio-atmosphere-dark text-[#F5F7FA]";

  const surfaceCardClass = isHC
    ? "bg-black border-2 border-yellow-400 text-white"
    : isLight
      ? "studio-card-light ring-1 ring-black/[0.07] text-[#0F1419]"
      : "studio-card-dark ring-1 ring-white/[0.08] text-[#F5F7FA]";

  const subtlePanelClass = isHC
    ? "bg-black border border-yellow-400 text-white"
    : isLight
      ? "bg-[#EDEAE2]/80 ring-1 ring-black/[0.06] text-[#0F1419]"
      : "bg-[#0B0F17]/90 ring-1 ring-white/[0.07] text-[#F5F7FA]";

  const mutedTextClass = isHC
    ? "text-yellow-200"
    : isLight
      ? "text-[#4B5563]"
      : "text-slate-400";

  const primaryBtnClass = isHC
    ? "bg-yellow-400 text-black font-extrabold hover:bg-yellow-300"
    : "bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 shadow-lg shadow-emerald-500/20";

  const modalShellClass = isHC
    ? "bg-black border-2 border-yellow-400 text-white"
    : isLight
      ? "bg-white text-[#0F1419] ring-1 ring-black/10 shadow-2xl"
      : "bg-[#10141D] text-white ring-1 ring-white/15 shadow-2xl";

  return (
    <div className={`min-h-[100dvh] flex flex-col transition-colors duration-200 ${rootShellClass}`}>
      {/* WCAG 2.4.1 Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-emerald-400 focus:text-slate-950 focus:px-5 focus:py-2.5 focus:rounded-xl focus:text-sm focus:font-bold"
      >
        Pular para o conteúdo principal
      </a>

      <div role="status" aria-live="polite" className="sr-only">
        {a11yAnnouncement}
      </div>

      {/* ======================================================================
          FLOATING SPATIAL STUDIO HEADER
         ====================================================================== */}
      <header
        role="banner"
        className={`sticky top-0 z-30 safe-top backdrop-blur-xl border-b transition-colors ${
          isHC
            ? "bg-black border-yellow-400"
            : isLight
              ? "bg-[#F6F5F1]/88 border-black/[0.07]"
              : "bg-[#080A0F]/85 border-white/[0.07]"
        }`}
      >
        <div className="max-w-7xl mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Brand Identity: Acoustic Pulse Mark + Display Wordmark */}
          <button
            type="button"
            onClick={() => setActiveSection("studio")}
            className="flex items-center gap-3 text-left cursor-pointer group shrink-0"
            aria-label="FREETING Studio — Ir para o painel principal"
          >
            <div
              className={`h-10 w-10 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 ${
                isHC
                  ? "bg-yellow-400 text-black"
                  : "bg-[#121824] ring-1 ring-emerald-400/35 shadow-md shadow-emerald-500/10"
              }`}
            >
              <div className="flex items-end gap-0.5 h-4" aria-hidden="true">
                <span
                  className={`w-1 h-2.5 rounded-full ${
                    isHC ? "bg-black" : "bg-emerald-400"
                  }`}
                />
                <span
                  className={`w-1 h-4 rounded-full ${
                    isHC ? "bg-black" : "bg-emerald-300"
                  }`}
                />
                <span
                  className={`w-1 h-3 rounded-full ${
                    isHC ? "bg-black" : "bg-amber-400"
                  }`}
                />
                <span
                  className={`w-1 h-2 rounded-full ${
                    isHC ? "bg-black" : "bg-emerald-400"
                  }`}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg sm:text-xl font-extrabold tracking-tight">
                  FREETING
                </span>
                <span
                  className={`hidden sm:inline-block rounded-md px-1.5 py-0.5 font-mono-tabular text-[10px] font-bold uppercase tracking-wider ${
                    isHC
                      ? "bg-yellow-400 text-black"
                      : isLight
                        ? "bg-emerald-600/12 text-emerald-800"
                        : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25"
                  }`}
                >
                  STUDIO
                </span>
              </div>
              <span className={`hidden lg:block text-[11px] ${mutedTextClass}`}>
                P2P Livre · Gravação Ilimitada
              </span>
            </div>
          </button>

          {/* Desktop Segmented Navigation */}
          <nav
            aria-label="Seções do estúdio"
            className={`hidden md:flex items-center gap-1 rounded-2xl p-1 ${
              isHC
                ? "border-2 border-yellow-400 bg-black"
                : isLight
                  ? "bg-[#E6E2D8]/80 ring-1 ring-black/[0.06]"
                  : "bg-white/[0.04] ring-1 ring-white/[0.08]"
            }`}
          >
            {(
              [
                { id: "studio", label: "Estúdio", icon: Radio },
                { id: "demo", label: "Demo ao Vivo", icon: Play },
                {
                  id: "agenda",
                  label: `Agenda${meetings.length ? ` (${meetings.length})` : ""}`,
                  icon: Calendar,
                },
                {
                  id: "vault",
                  label: `Cofre Local${recordings.length ? ` (${recordings.length})` : ""}`,
                  icon: Disc,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    setActiveSection(tab.id);
                    if (tab.id === "vault") refreshRecordings();
                  }}
                  className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition cursor-pointer ${
                    isActive
                      ? isHC
                        ? "bg-yellow-400 text-black font-bold"
                        : isLight
                          ? "bg-white text-[#0F1419] shadow-xs"
                          : "bg-emerald-500 text-slate-950 font-bold"
                      : "opacity-80 hover:opacity-100"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Accessibility & Privacy Cluster (All >= 40x40px WCAG Targets) */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                const nextTheme: HomeThemeMode =
                  theme === "dark"
                    ? "light"
                    : theme === "light"
                      ? "high-contrast"
                      : "dark";
                setTheme(nextTheme);
                const label =
                  nextTheme === "dark"
                    ? "Estúdio Escuro"
                    : nextTheme === "light"
                      ? "Claro Editorial"
                      : "Alto Contraste AAA";
                announce(`Tema alterado para ${label}`);
              }}
              aria-label="Alternar tema de cor e contraste"
              title="Tema: Estúdio Escuro / Claro Editorial / Alto Contraste AAA"
              className={`h-10 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${subtlePanelClass}`}
            >
              {theme === "dark" && <Moon className="h-4 w-4 text-emerald-400" />}
              {theme === "light" && <Sun className="h-4 w-4 text-amber-600" />}
              {theme === "high-contrast" && (
                <Contrast className="h-4 w-4 text-yellow-300" />
              )}
              <span className="hidden sm:inline">
                {theme === "dark"
                  ? "Estúdio"
                  : theme === "light"
                    ? "Claro"
                    : "AAA"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const nextScale =
                  fontScale === 100 ? 115 : fontScale === 115 ? 130 : 100;
                setFontScale(nextScale);
                announce(`Escala de leitura ajustada para ${nextScale}%`);
              }}
              aria-label={`Escala de fonte atual ${fontScale}%. Clique para ampliar ou restaurar`}
              title="Acessibilidade: Escala de Texto (100% / 115% / 130%)"
              className={`h-10 px-2.5 rounded-xl font-mono-tabular text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer ${subtlePanelClass}`}
            >
              <Accessibility
                className={`h-4 w-4 ${
                  isHC ? "text-yellow-300" : "text-emerald-500"
                }`}
              />
              <span>{fontScale}%</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSecurityModal(true)}
              aria-label="Central de Privacidade e Direitos LGPD"
              title="Segurança & Privacidade LGPD"
              className={`h-10 w-10 rounded-xl inline-flex items-center justify-center transition cursor-pointer ${subtlePanelClass}`}
            >
              <ShieldCheck
                className={`h-4 w-4 ${
                  isHC ? "text-yellow-300" : "text-emerald-500"
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              aria-label="Padrões de áudio e vídeo do estúdio"
              title="Áudio e Vídeo"
              className={`h-10 w-10 rounded-xl inline-flex items-center justify-center transition cursor-pointer ${subtlePanelClass}`}
            >
              <Settings className="h-4 w-4 opacity-85" />
            </button>
          </div>
        </div>
      </header>

      {/* ======================================================================
          MAIN STUDIO BENTO WORKSPACE
         ====================================================================== */}
      <main
        id="main-content"
        className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5 sm:pt-8 pb-28 md:pb-16 space-y-8 sm:space-y-10"
      >
        {/* 1. HERO COMMAND DECK (Shown on "studio") */}
        {activeSection === "studio" && (
          <section
            aria-label="Painel de comando para iniciar ou entrar em salas"
            className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch"
          >
            {/* Left 7 Columns: Manifesto + Tactile Room Launcher */}
            <div
              className={`lg:col-span-7 rounded-[28px] p-5 sm:p-8 flex flex-col justify-between gap-6 ${surfaceCardClass}`}
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold tracking-wider uppercase ${
                      isHC
                        ? "bg-yellow-400 text-black"
                        : isLight
                          ? "bg-emerald-600/12 text-emerald-900 ring-1 ring-emerald-600/25"
                          : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
                    Zero Limite de 60 Minutos · Zero Login
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono-tabular text-[11px] font-medium ${subtlePanelClass}`}
                  >
                    <Lock className="h-3 w-3 text-amber-400" />
                    WebRTC P2P + LGPD Art. 46
                  </span>
                </div>

                <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold leading-[1.08] text-balance">
                  Reuniões e gravações livres, com ergonomia de estúdio.
                </h1>

                <p className={`text-sm sm:text-base leading-relaxed max-w-2xl ${mutedTextClass}`}>
                  Abra uma sala criptografada em 1 clique no computador ou celular, apresente sem efeito de tela infinita e salve horas de gravação direto no seu dispositivo.
                </p>
              </div>

              {/* Concentric Action Console: R_outer (22px) -> inner controls (12px) */}
              <div className={`rounded-[22px] p-3.5 sm:p-4 space-y-3.5 ${subtlePanelClass}`}>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <button
                    type="button"
                    onClick={handleStartInstantMeeting}
                    className={`sm:col-span-6 min-h-[52px] px-5 rounded-[14px] text-sm inline-flex items-center justify-center gap-2.5 transition active:scale-[0.99] cursor-pointer ${primaryBtnClass}`}
                  >
                    <Video className="h-5 w-5 shrink-0" />
                    <span>Abrir Estúdio Agora</span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={handleCreateMeetingForLater}
                    className={`sm:col-span-3 min-h-[52px] px-3.5 rounded-[14px] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition cursor-pointer ${surfaceCardClass} hover:opacity-90`}
                  >
                    <Link2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Gerar Link</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenScheduleModal}
                    className={`sm:col-span-3 min-h-[52px] px-3.5 rounded-[14px] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition cursor-pointer ${surfaceCardClass} hover:opacity-90`}
                  >
                    <Calendar className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>Agendar</span>
                  </button>
                </div>

                {/* Join Existing Room Bar (16px font on mobile prevents iOS auto-zoom) */}
                <form
                  onSubmit={handleJoinRoom}
                  role="search"
                  aria-label="Entrar em uma sala existente com código ou link"
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <div
                    className={`flex-1 flex items-center rounded-[14px] min-h-[50px] pl-3.5 pr-2 ${surfaceCardClass}`}
                  >
                    <span className="font-mono-tabular text-xs font-bold text-emerald-400 mr-2 shrink-0">
                      SALA
                    </span>
                    <input
                      type="text"
                      value={joinInput}
                      onChange={(e) => {
                        setJoinInput(e.target.value);
                        if (joinError) setJoinError(null);
                      }}
                      placeholder="abc-defg-hij ou cole o link..."
                      aria-label="Digite o código ou link da sala"
                      className="bg-transparent font-mono-tabular text-base sm:text-sm focus:outline-none flex-1 min-w-0 placeholder:opacity-55"
                    />
                    <button
                      type="button"
                      onClick={handlePasteFromClipboard}
                      title="Colar código ou link copiado"
                      aria-label="Colar código da área de transferência"
                      className="h-9 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1 opacity-75 hover:opacity-100 cursor-pointer shrink-0"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Colar</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    className={`min-h-[50px] px-6 rounded-[14px] text-sm font-bold transition cursor-pointer shrink-0 ${
                      joinInput.trim()
                        ? primaryBtnClass
                        : `${surfaceCardClass} opacity-90 hover:opacity-100`
                    }`}
                  >
                    Entrar na Sala
                  </button>
                </form>

                {joinError && (
                  <div
                    role="alert"
                    className="rounded-xl bg-rose-500/15 ring-1 ring-rose-400/40 px-3.5 py-2 text-xs font-medium text-rose-300"
                  >
                    {joinError}
                  </div>
                )}
              </div>

              {/* Quick Trust & AI Capabilities Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span className={`inline-flex items-center gap-1.5 ${mutedTextClass}`}>
                    <Disc className="h-3.5 w-3.5 text-rose-400" />
                    Gravação .MP4 (iOS) e .WebM (PC/Android)
                  </span>
                  <span className={`inline-flex items-center gap-1.5 ${mutedTextClass}`}>
                    <Layers className="h-3.5 w-3.5 text-emerald-400" />
                    Até 16 vídeos por página + Modo Economia
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAiNotesModal(true)}
                  className="inline-flex items-center gap-1.5 font-semibold text-amber-400 hover:underline cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Como funcionam as Atas por IA</span>
                </button>
              </div>
            </div>

            {/* Right 5 Columns: Art-Directed Studio Hero Showcase Card */}
            <div
              className={`lg:col-span-5 rounded-[28px] p-3 flex flex-col justify-between ${surfaceCardClass}`}
            >
              {/* Concentric Image Frame: R_outer (28px) - Padding (12px) = R_inner (16px) */}
              <div className="relative flex-1 min-h-[260px] sm:min-h-[320px] overflow-hidden rounded-[16px] bg-[#080A0F] ring-1 ring-white/10">
                <img
                  src="/media/freeting-studio-hero.jpg"
                  alt="Mesa acústica do estúdio FREETING com microfone condensador preto fosco, lentes ópticas e iluminação esmeralda e âmbar"
                  className="h-full w-full object-cover object-center"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#080A0F] via-[#080A0F]/35 to-transparent"
                />

                {/* Top Floating Studio Spec Badge */}
                <div className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-black/70 backdrop-blur-md px-3 py-1 font-mono-tabular text-[11px] font-semibold text-emerald-300 ring-1 ring-white/15">
                    ● ÁUDIO & VÍDEO ADAPTATIVO
                  </span>
                  <span className="rounded-full bg-black/70 backdrop-blur-md px-2.5 py-1 font-mono-tabular text-[11px] text-amber-300 ring-1 ring-white/15">
                    4G/5G TURN
                  </span>
                </div>

                {/* Bottom Studio Telemetry Overlay */}
                <div className="absolute bottom-3.5 left-3.5 right-3.5 rounded-xl bg-black/75 backdrop-blur-md p-3.5 text-white ring-1 ring-white/15">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-display text-sm font-bold">
                        Arquitetura Independente P2P
                      </div>
                      <div className="text-[11px] text-slate-300 mt-0.5">
                        Seus vídeos e gravações nunca ficam presos em nuvem de terceiros.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSection("demo")}
                      className="shrink-0 h-9 px-3 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:bg-emerald-400"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Ver Demo</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 2. LIVE INTERACTIVE DEMONSTRATIVE VIDEO STAGE (Shown on "studio" & "demo") */}
        {(activeSection === "studio" || activeSection === "demo") && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="font-display text-lg sm:text-xl font-bold">
                  Conheça o Estúdio em Movimento
                </h2>
                <p className={`text-xs sm:text-sm ${mutedTextClass}`}>
                  Demonstração interativa em tempo real dos recursos exclusivos do FREETING
                </p>
              </div>
            </div>
            <FreetingStudioDemoReel
              isHighContrast={isHC}
              isLight={isLight}
              onLaunchStudio={handleStartInstantMeeting}
            />
          </div>
        )}

        {/* 3. DUAL WORKSPACE BENTO: AGENDA + LOCAL RECORDING VAULT */}
        <div
          className={`grid grid-cols-1 ${
            activeSection === "studio" ? "lg:grid-cols-12" : "lg:grid-cols-1"
          } gap-6 items-start`}
        >
          {/* AGENDA PANEL */}
          {(activeSection === "studio" || activeSection === "agenda") && (
            <section
              aria-label="Agenda de sessões e reuniões"
              className={`${
                activeSection === "studio" ? "lg:col-span-7" : ""
              } rounded-[28px] p-5 sm:p-6 space-y-5 ${surfaceCardClass}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-emerald-500">
                    Programação do Estúdio
                  </span>
                  <h2 className="font-display text-xl font-bold mt-0.5">
                    {formatPortugueseDateHeader(selectedDate)}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDate(new Date())}
                    className={`h-9 px-3 rounded-xl text-xs font-semibold cursor-pointer ${subtlePanelClass}`}
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenScheduleModal}
                    className={`h-9 px-3.5 rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer ${primaryBtnClass}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Agendar Sessão</span>
                  </button>
                </div>
              </div>

              {/* 7-Day Accessible Tactile Strip */}
              <div
                role="group"
                aria-label="Dias da semana"
                className="flex items-center gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => setSelectedDate((d) => shiftDateByDays(d, -7))}
                  aria-label="Semana anterior"
                  className={`h-11 w-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer ${subtlePanelClass}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="grid grid-cols-7 gap-1.5 flex-1">
                  {weekStrip.map((day) => (
                    <button
                      key={day.dateIso}
                      type="button"
                      aria-pressed={day.isSelected}
                      onClick={() => {
                        const [y, m, d] = day.dateIso.split("-").map(Number);
                        setSelectedDate(new Date(y, m - 1, d, 12, 0, 0));
                      }}
                      className={`min-h-[54px] rounded-2xl flex flex-col items-center justify-center transition cursor-pointer ${
                        day.isSelected
                          ? primaryBtnClass
                          : `${subtlePanelClass} opacity-80 hover:opacity-100`
                      }`}
                    >
                      <span className="text-[10px] uppercase tracking-wider font-semibold">
                        {day.dayOfWeekShort}
                      </span>
                      <span className="font-mono-tabular text-sm font-bold mt-0.5">
                        {day.dayNumber}
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedDate((d) => shiftDateByDays(d, 7))}
                  aria-label="Próxima semana"
                  className={`h-11 w-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer ${subtlePanelClass}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Meetings List or Acoustic Empty State */}
              {todaysMeetings.length === 0 ? (
                <div className={`rounded-2xl p-6 text-center space-y-3 ${subtlePanelClass}`}>
                  <FreetingEmptyIllustration />
                  <div>
                    <h3 className="font-display text-base font-bold">
                      Agenda livre nesta data
                    </h3>
                    <p className={`text-xs mt-1 ${mutedTextClass}`}>
                      Inicie um estúdio imediato ou deixe um horário preparado para sua equipe.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
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
                        className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 ${subtlePanelClass}`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-lg bg-emerald-500/15 px-2.5 py-0.5 font-mono-tabular text-xs font-bold text-emerald-400 inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {mtg.startTime}
                            </span>
                            <code className="font-mono-tabular text-xs opacity-80">
                              {mtg.roomCode}
                            </code>
                          </div>
                          <h3 className="font-display text-base font-bold truncate">
                            {mtg.title}
                          </h3>
                          {mtg.description && (
                            <p className={`text-xs truncate ${mutedTextClass}`}>
                              {mtg.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyOrShareLink(mtgLink, true)}
                            aria-label={`Compartilhar link da sessão ${mtg.title}`}
                            className={`h-10 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${surfaceCardClass}`}
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            <span>Convite</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMeeting(mtg.id)}
                            aria-label={`Remover sessão ${mtg.title}`}
                            className="h-10 w-10 rounded-xl bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => enterRoom(mtg.roomCode, false)}
                            className={`h-10 px-4 rounded-xl text-xs cursor-pointer ${primaryBtnClass}`}
                          >
                            Entrar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* LOCAL RECORDING VAULT PANEL */}
          {(activeSection === "studio" || activeSection === "vault") && (
            <section
              aria-label="Cofre local de gravações ilimitadas"
              className={`${
                activeSection === "studio" ? "lg:col-span-5" : ""
              } rounded-[28px] p-5 sm:p-6 space-y-4 ${surfaceCardClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono-tabular text-[11px] font-bold uppercase tracking-wider text-amber-400">
                    IndexedDB no Dispositivo
                  </span>
                  <h2 className="font-display text-xl font-bold mt-0.5 flex items-center gap-2">
                    <Disc className="h-5 w-5 text-rose-400" />
                    Cofre de Gravações ({recordings.length})
                  </h2>
                </div>
              </div>

              <p className={`text-xs leading-relaxed ${mutedTextClass}`}>
                Gravações ficam 100% no seu navegador sem upload para servidores externos, prontas para assistir ou baixar em <code>.mp4</code> / <code>.webm</code>.
              </p>

              {recordings.length === 0 ? (
                <div className={`rounded-2xl p-6 text-center space-y-2 ${subtlePanelClass}`}>
                  <Disc className="h-7 w-7 mx-auto text-slate-400 opacity-70" />
                  <div className="text-sm font-semibold">
                    Nenhuma gravação salva neste navegador
                  </div>
                  <p className={`text-xs ${mutedTextClass}`}>
                    Dentro de qualquer sala, clique em <strong>Gravar (Alt+R)</strong> para registrar áudio e vídeo sem limite de tempo.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recordings.map((rec) => {
                    const ext = getRecordingFileExtension(rec.mimeType).toUpperCase();
                    return (
                      <div
                        key={rec.sessionId}
                        className={`rounded-2xl p-3.5 space-y-3 ${subtlePanelClass}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">
                              {rec.title}
                            </div>
                            <div className={`font-mono-tabular text-[11px] mt-0.5 ${mutedTextClass}`}>
                              {rec.roomCode} · {formatUnlimitedDuration(rec.durationSeconds)} ·{" "}
                              {formatRecordingBytes(rec.totalBytes)}
                            </div>
                          </div>
                          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono-tabular text-[10px] font-bold text-emerald-400 shrink-0">
                            .{ext}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePreviewRecording(rec)}
                            className={`flex-1 h-9 px-3 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer ${primaryBtnClass}`}
                          >
                            <Play className="h-3.5 w-3.5" />
                            <span>Assistir</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadRecording(rec)}
                            className={`flex-1 h-9 px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${surfaceCardClass}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Baixar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecording(rec.sessionId)}
                            aria-label={`Excluir gravação ${rec.title}`}
                            className="h-9 w-9 rounded-xl bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 flex items-center justify-center cursor-pointer shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* ======================================================================
          MOBILE ERGONOMIC BOTTOM DOCK (< md)
         ====================================================================== */}
      <nav
        aria-label="Navegação inferior do estúdio"
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 safe-bottom backdrop-blur-xl border-t ${
          isHC
            ? "bg-black border-yellow-400"
            : isLight
              ? "bg-[#F6F5F1]/95 border-black/10"
              : "bg-[#080A0F]/95 border-white/10"
        }`}
      >
        <div className="grid grid-cols-4 h-16 px-2 gap-1">
          {(
            [
              { id: "studio", label: "Estúdio", icon: Radio },
              { id: "demo", label: "Demo", icon: Play },
              { id: "agenda", label: "Agenda", icon: Calendar },
              { id: "vault", label: "Cofre", icon: Disc },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  setActiveSection(item.id);
                  if (item.id === "vault") refreshRecordings();
                }}
                className="flex flex-col items-center justify-center gap-1 cursor-pointer relative"
              >
                <div
                  className={`w-12 h-7 rounded-xl flex items-center justify-center transition ${
                    isActive
                      ? isHC
                        ? "bg-yellow-400 text-black"
                        : "bg-emerald-500 text-slate-950"
                      : "opacity-75"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-[11px] font-semibold">{item.label}</span>
                {item.id === "vault" && recordings.length > 0 && (
                  <span className="absolute top-1 right-3 bg-rose-500 text-white font-mono-tabular text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {recordings.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ======================================================================
          MODALS (Studio-Themed & Accessible)
         ====================================================================== */}
      {previewRecordingUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reprodutor de gravação local"
          className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-3xl w-full p-5 safe-bottom space-y-4 animate-sheet-up ${modalShellClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold truncate pr-2">
                {previewRecordingUrl.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewRecordingUrl.url);
                  setPreviewRecordingUrl(null);
                }}
                aria-label="Fechar reprodutor"
                className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${subtlePanelClass}`}
              >
                <X className="h-4 w-4" />
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
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 safe-bottom space-y-4 animate-sheet-up ${modalShellClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                Link do Estúdio Pronto
              </h3>
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                aria-label="Fechar janela"
                className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${subtlePanelClass}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className={`text-xs sm:text-sm ${mutedTextClass}`}>
              Envie este endereço para quem vai participar. Ninguém precisa criar conta para entrar.
            </p>
            <div className={`rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2 ${subtlePanelClass}`}>
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
                  className="h-9 w-9 rounded-xl hover:bg-emerald-500/15 flex items-center justify-center cursor-pointer"
                  title="Copiar link"
                >
                  {copiedCode ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
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
                  className="h-9 w-9 rounded-xl hover:bg-emerald-500/15 flex items-center justify-center cursor-pointer"
                  title="Compartilhar"
                >
                  <Share2 className="h-4 w-4 text-emerald-400" />
                </button>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setLaterRoomCode(null)}
                className={`h-11 px-4 rounded-xl text-sm font-semibold cursor-pointer ${subtlePanelClass}`}
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
                className={`flex-1 sm:flex-none h-11 px-5 rounded-xl text-sm cursor-pointer ${primaryBtnClass}`}
              >
                Abrir Sala Agora
              </button>
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <form
            onSubmit={handleSaveScheduledMeeting}
            className={`rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 safe-bottom space-y-4 animate-sheet-up ${modalShellClass}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                Agendar Sessão no Estúdio
              </h3>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                aria-label="Fechar agendamento"
                className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${subtlePanelClass}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className={`block text-xs font-semibold mb-1.5 ${mutedTextClass}`}>
                Título da sessão
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Revisão de Arquitetura / Consulta"
                className={`w-full rounded-xl px-3.5 py-3 text-base sm:text-sm focus:outline-none ${subtlePanelClass}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${mutedTextClass}`}>
                  Data selecionada
                </label>
                <input
                  type="text"
                  disabled
                  value={formatPortugueseDateHeader(selectedDate)}
                  className={`w-full rounded-xl px-3.5 py-3 text-base sm:text-sm opacity-75 ${subtlePanelClass}`}
                />
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1.5 ${mutedTextClass}`}>
                  Horário
                </label>
                <input
                  type="time"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-3 font-mono-tabular text-base sm:text-sm focus:outline-none ${subtlePanelClass}`}
                />
              </div>
            </div>
            <div>
              <label className={`block text-xs font-semibold mb-1.5 ${mutedTextClass}`}>
                Pauta / Observações (opcional)
              </label>
              <textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Tópicos principais para os participantes"
                className={`w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm focus:outline-none ${subtlePanelClass}`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className={`h-11 px-4 rounded-xl text-sm font-semibold cursor-pointer ${subtlePanelClass}`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={`flex-1 sm:flex-none h-11 px-6 rounded-xl text-sm cursor-pointer ${primaryBtnClass}`}
              >
                Salvar na Agenda
              </button>
            </div>
          </form>
        </div>
      )}

      {showAiNotesModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-6 safe-bottom space-y-4 animate-sheet-up ${modalShellClass}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="font-display text-lg font-bold">
                  Assistente de Atas em Português
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                aria-label="Fechar janela"
                className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${subtlePanelClass}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className={`text-sm leading-relaxed ${mutedTextClass}`}>
              Dentro da sala, o painel de IA consolida legendas ao vivo e mensagens do chat para gerar atas estruturadas em Markdown, com mascaramento automático de dados sensíveis (CPF, CNPJ, e-mail e telefone).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAiNotesModal(false)}
                className={`h-11 px-4 rounded-xl text-sm font-semibold cursor-pointer ${subtlePanelClass}`}
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleStartInstantMeeting}
                className={`flex-1 sm:flex-none h-11 px-5 rounded-xl text-sm cursor-pointer ${primaryBtnClass}`}
              >
                Abrir Sala com IA
              </button>
            </div>
          </div>
        </div>
      )}

      {showSecurityModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-6 safe-bottom space-y-4 max-h-[90dvh] overflow-y-auto animate-sheet-up ${modalShellClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                <span>Segurança & Privacidade LGPD</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowSecurityModal(false);
                  setLgpdFeedback(null);
                }}
                aria-label="Fechar central LGPD"
                className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${subtlePanelClass}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className={`text-xs leading-relaxed ${mutedTextClass}`}>
              Em conformidade com a <strong>Lei nº 13.709/2018 (LGPD)</strong>, o FREETING opera por minimização de dados (Art. 6º, III): zero cadastro obrigatório e cofre de gravações 100% local no dispositivo do titular.
            </p>

            <div className={`p-4 rounded-2xl space-y-3 text-xs ${subtlePanelClass}`}>
              <label className="flex items-start justify-between gap-3 cursor-pointer">
                <div>
                  <div className="font-bold">
                    Mascaramento Automático DLP (Art. 5º e Art. 46)
                  </div>
                  <div className={`mt-0.5 ${mutedTextClass}`}>
                    Oculta automaticamente CPFs, CNPJs, cartões, e-mails e telefones no chat e nas transcrições.
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
                  className="mt-1 h-5 w-5 accent-emerald-500 shrink-0"
                />
              </label>
            </div>

            <div className={`p-4 rounded-2xl space-y-3 text-xs ${subtlePanelClass}`}>
              <div className="font-bold">
                Direitos Imediatos do Titular (Art. 18 da LGPD)
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleExportLgpdDataPortability}
                  className={`h-10 px-3.5 rounded-xl font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${surfaceCardClass}`}
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  Exportar Portabilidade JSON
                </button>
                <button
                  type="button"
                  onClick={handleEraseAllPersonalDataLgpd}
                  className="h-10 px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar Todos os Dados
                </button>
              </div>
              {lgpdFeedback && (
                <div className="text-[11px] font-semibold text-emerald-400 pt-1">
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
                className={`w-full sm:w-auto h-11 px-6 rounded-xl text-sm cursor-pointer ${primaryBtnClass}`}
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {!lgpdConsent.acceptedPrivacyNotice && (
        <div
          role="region"
          aria-label="Aviso de Privacidade e LGPD"
          className={`fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-[92%] rounded-2xl px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${modalShellClass}`}
        >
          <div className="leading-relaxed">
            <strong>Privacidade por Padrão (LGPD):</strong> Sem conta obrigatória e gravações mantidas exclusivamente no seu navegador.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSecurityModal(true)}
              className={`flex-1 sm:flex-none h-9 px-3.5 rounded-xl font-semibold cursor-pointer ${subtlePanelClass}`}
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
              className={`flex-1 sm:flex-none h-9 px-4 rounded-xl cursor-pointer ${primaryBtnClass}`}
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 z-50"
        >
          <div className={`rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 safe-bottom space-y-4 animate-sheet-up ${modalShellClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold flex items-center gap-2">
                <Settings className="h-5 w-5 text-emerald-400" />
                Padrões do Estúdio
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                aria-label="Fechar configurações"
                className={`h-9 w-9 rounded-xl flex items-center justify-center cursor-pointer ${subtlePanelClass}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className={`p-3.5 rounded-2xl flex items-center gap-3 ${subtlePanelClass}`}>
                <Mic className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-semibold">Captação de Voz Prioritária</div>
                  <div className={`text-xs ${mutedTextClass}`}>
                    Cancelamento de eco + seleção de microfone/saída dentro do camarim e da sala
                  </div>
                </div>
              </div>
              <div className={`p-3.5 rounded-2xl flex items-center gap-3 ${subtlePanelClass}`}>
                <Camera className="h-5 w-5 text-amber-400 shrink-0" />
                <div>
                  <div className="font-semibold">Vídeo HD Adaptativo (QoS)</div>
                  <div className={`text-xs ${mutedTextClass}`}>
                    Escala automática de bitrate e FPS conforme número de participantes
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className={`w-full sm:w-auto h-11 px-6 rounded-xl text-sm cursor-pointer ${primaryBtnClass}`}
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
