"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Keyboard,
  Video,
  Sparkles,
  HelpCircle,
  Settings,
  Grid,
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
import { MeetEmptyIllustration } from "./MeetEmptyIllustration";

const STORAGE_MEETINGS_KEY = "freeting_scheduled_meetings_v1";

export function MeetHomeDashboard() {
  const router = useRouter();

  // Reference default date matching user's screenshot ("seg., 23 de nov.") or current date
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date(2026, 10, 23, 12, 0, 0));
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<"meetings" | "calls" | "recordings">("meetings");

  // Dropdown & Modals
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [laterRoomCode, setLaterRoomCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showAiNotesModal, setShowAiNotesModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Schedule Form State
  const [newTitle, setNewTitle] = useState("");
  const [newStartTime, setNewStartTime] = useState("19:00");
  const [newDescription, setNewDescription] = useState("");

  // Persisted Meetings & Recordings
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [recordings, setRecordings] = useState<StoredRecordingMeta[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MEETINGS_KEY);
      if (raw) {
        setMeetings(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
    refreshRecordings();
  }, []);

  const refreshRecordings = async () => {
    const items = await listRecordingsFromVault();
    setRecordings(items);
  };

  const persistMeetings = (next: ScheduledMeeting[]) => {
    setMeetings(next);
    try {
      localStorage.setItem(STORAGE_MEETINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const weekStrip = buildWeekStrip(selectedDate, new Date(2026, 10, 23, 12, 0, 0));
  const selectedDateIso = toLocalDateIso(selectedDate);
  const todaysMeetings = filterMeetingsForDate(meetings, selectedDateIso);

  const handleJoinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!joinInput.trim()) {
      const instantCode = generateRoomCode();
      router.push(`/room/${instantCode}`);
      return;
    }
    const extracted = extractRoomCode(joinInput);
    if (!extracted) {
      setJoinError("Digite um código válido no formato xxx-xxxx-xxx ou cole o link da sala.");
      return;
    }
    setJoinError(null);
    router.push(`/room/${extracted}`);
  };

  const handleStartInstantMeeting = () => {
    setShowNewMenu(false);
    const code = generateRoomCode();
    router.push(`/room/${code}`);
  };

  const handleCreateMeetingForLater = () => {
    setShowNewMenu(false);
    setLaterRoomCode(generateRoomCode());
    setCopiedCode(false);
  };

  const handleOpenScheduleModal = () => {
    setShowNewMenu(false);
    setNewTitle("");
    setNewStartTime("19:00");
    setNewDescription("");
    setShowScheduleModal(true);
  };

  const handleSaveScheduledMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    const code = generateRoomCode();
    const created: ScheduledMeeting = {
      id: `mtg_${Date.now()}`,
      title: newTitle.trim() || "Reunião Sem Limite FREETING",
      roomCode: code,
      dateIso: selectedDateIso,
      startTime: newStartTime,
      endTime: "∞ Sem Limite",
      hostName: "Erick",
      status: "SCHEDULED",
      aiNotesEnabled: true,
      unlimitedRecordingEnabled: true,
      description: newDescription.trim() || "Tempo de reunião e gravação 100% ilimitados.",
    };
    persistMeetings([...meetings, created]);
    setShowScheduleModal(false);
  };

  const handleDeleteMeeting = (id: string) => {
    persistMeetings(meetings.filter((m) => m.id !== id));
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleDownloadRecording = async (rec: StoredRecordingMeta) => {
    const blob = await assembleRecordingBlobFromVault(rec.sessionId, rec.mimeType);
    if (blob) {
      triggerBlobDownload(blob, `freeting-${rec.roomCode}-${rec.sessionId}.webm`);
    }
  };

  const handleDeleteRecording = async (sessionId: string) => {
    await deleteRecordingFromVault(sessionId);
    await refreshRecordings();
  };

  return (
    <div className="min-h-screen bg-white text-[#1f1f1f] flex flex-col">
      {/* TOP HEADER BAR — Faithful to Screenshot 1 */}
      <header className="h-16 px-4 flex items-center justify-between border-b border-transparent select-none">
        {/* Left: Google Meet Style Logo + FREETING Brand */}
        <div className="flex items-center gap-2.5 min-w-[200px]">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#fbbc04] via-[#34a853] to-[#4285f4] p-0.5 shadow-xs">
            <div className="w-full h-full bg-white rounded-[6px] flex items-center justify-center">
              <Video className="w-5 h-5 text-[#1a73e8]" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[22px] font-normal tracking-tight text-[#5f6368]">
              Freeting
            </span>
            <span
              title="Reuniões e gravações sem limite de 1 hora"
              className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold bg-[#e6f4ea] text-[#137333] px-2 py-0.5 rounded-full border border-[#ceead6]"
            >
              <InfinityIcon className="w-3.5 h-3.5" />
              Sem Limites
            </span>
          </div>
        </div>

        {/* Center Action Bar: Code Input + Participar + Nova + Anotações IA */}
        <div className="flex items-center gap-2.5 flex-wrap justify-center">
          <form
            onSubmit={handleJoinRoom}
            className="flex items-center bg-[#f1f3f4] hover:bg-[#e8eaed] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0b57d0] rounded-full h-11 pl-4 pr-1.5 transition-all"
          >
            <Keyboard className="w-5 h-5 text-[#5f6368] mr-2.5 shrink-0" />
            <input
              type="text"
              value={joinInput}
              onChange={(e) => {
                setJoinInput(e.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="Digite um código ou link"
              aria-label="Digite um código ou link"
              className="bg-transparent text-sm text-[#1f1f1f] placeholder-[#5f6368] focus:outline-none w-44 sm:w-52"
            />
            <button
              type="submit"
              className={`ml-2 px-4 h-8 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                joinInput.trim()
                  ? "bg-[#0b57d0] text-white hover:bg-[#0842a0]"
                  : "bg-[#e0e2e5] text-[#80868b] hover:bg-[#d2d5d9] hover:text-[#1f1f1f]"
              }`}
            >
              Participar
            </button>
          </form>

          {/* "+ Nova" Green Pill Button with Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNewMenu((v) => !v)}
              className="h-11 px-4 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
            >
              <Video className="w-4 h-4" />
              <span>Nova</span>
            </button>

            {showNewMenu && (
              <div className="absolute left-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-[#e0e2e5] py-2 z-50">
                <button
                  type="button"
                  onClick={handleCreateMeetingForLater}
                  className="w-full px-4 py-3 text-left text-sm text-[#1f1f1f] hover:bg-[#f1f3f4] flex items-center gap-3 cursor-pointer"
                >
                  <Link2 className="w-4 h-4 text-[#444746]" />
                  <div>
                    <div className="font-medium">Criar uma reunião para depois</div>
                    <div className="text-xs text-[#5f6368]">Gere um link sem limite de tempo</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={handleStartInstantMeeting}
                  className="w-full px-4 py-3 text-left text-sm text-[#1f1f1f] hover:bg-[#f1f3f4] flex items-center gap-3 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#0f5223]" />
                  <div>
                    <div className="font-medium">Iniciar uma reunião instantânea</div>
                    <div className="text-xs text-[#137333]">Entrar agora • Gravação ∞ liberada</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={handleOpenScheduleModal}
                  className="w-full px-4 py-3 text-left text-sm text-[#1f1f1f] hover:bg-[#f1f3f4] flex items-center gap-3 cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-[#0b57d0]" />
                  <div>
                    <div className="font-medium">Agendar na Agenda FREETING</div>
                    <div className="text-xs text-[#5f6368]">Adicionar ao calendário semanal</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* "Anotações feitas por IA" Light Blue Pill Button */}
          <button
            type="button"
            onClick={() => setShowAiNotesModal(true)}
            className="h-11 px-4 rounded-full bg-[#d3e3fd] hover:bg-[#c2d7fa] text-[#041e49] text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#0b57d0]" />
            <span className="max-w-[130px] truncate">Anotações feit...</span>
          </button>
        </div>

        {/* Right Icons: Help, Settings, Apps, Avatar */}
        <div className="flex items-center gap-1.5 min-w-[160px] justify-end">
          <button
            type="button"
            onClick={() => setShowSecurityModal(true)}
            title="Engenharia Reversa REA & Comparativo Sem Limites"
            className="w-10 h-10 rounded-full hover:bg-[#f1f3f4] flex items-center justify-center text-[#5f6368] cursor-pointer"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            title="Configurações de Áudio, Vídeo e Gravação Ilimitada"
            className="w-10 h-10 rounded-full hover:bg-[#f1f3f4] flex items-center justify-center text-[#5f6368] cursor-pointer"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveNav("recordings");
              refreshRecordings();
            }}
            title="Cofre de Gravações Ilimitadas"
            className="w-10 h-10 rounded-full hover:bg-[#f1f3f4] flex items-center justify-center text-[#5f6368] cursor-pointer"
          >
            <Grid className="w-5 h-5" />
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
        <div className="mx-auto mt-1 text-xs text-[#d93025] bg-[#fce8e6] px-4 py-1.5 rounded-full">
          {joinError}
        </div>
      )}

      {/* BODY: LEFT NAVIGATION RAIL + MAIN CONTENT */}
      <div className="flex-1 flex">
        {/* Left Navigation Rail — Matching Screenshot 1 */}
        <aside className="w-20 pt-6 flex flex-col items-center gap-5 select-none shrink-0">
          <button
            type="button"
            onClick={() => setActiveNav("meetings")}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "meetings"
                  ? "bg-[#c2e7ff] text-[#001d35]"
                  : "text-[#444746] group-hover:bg-[#f1f3f4]"
              }`}
            >
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-[#1f1f1f]">Reuniões</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav("calls")}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "calls"
                  ? "bg-[#c2e7ff] text-[#001d35]"
                  : "text-[#444746] group-hover:bg-[#f1f3f4]"
              }`}
            >
              <Phone className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-[#444746]">Ligações</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveNav("recordings");
              refreshRecordings();
            }}
            className="flex flex-col items-center gap-1 group cursor-pointer relative"
          >
            <div
              className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                activeNav === "recordings"
                  ? "bg-[#c4eed0] text-[#0f5223]"
                  : "text-[#444746] group-hover:bg-[#f1f3f4]"
              }`}
            >
              <Disc className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-[#444746]">Gravações ∞</span>
            {recordings.length > 0 && (
              <span className="absolute -top-1 right-2 bg-[#0f5223] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {recordings.length}
              </span>
            )}
          </button>
        </aside>

        {/* Main Content Container */}
        <main className="flex-1 max-w-4xl mx-auto px-6 pt-5 pb-16">
          {activeNav === "meetings" && (
            <>
              {/* Date Strip Header — Exact match to Screenshot 1 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-[22px] font-normal text-[#1f1f1f]">
                    {formatPortugueseDateHeader(selectedDate)}
                  </h1>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(new Date(2026, 10, 23, 12, 0, 0))}
                    title="Voltar para seg., 23 de nov."
                    className="p-1.5 rounded-full hover:bg-[#f1f3f4] text-[#444746] cursor-pointer"
                  >
                    <Calendar className="w-4 h-4" />
                  </button>
                </div>

                {/* 7-Day Week Selector Strip */}
                <div className="flex items-center gap-1.5 select-none">
                  <button
                    type="button"
                    onClick={() => setSelectedDate((d) => shiftDateByDays(d, -7))}
                    aria-label="Semana anterior"
                    className="w-8 h-8 rounded-full hover:bg-[#f1f3f4] flex items-center justify-center text-[#444746] cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 sm:gap-2">
                    {weekStrip.map((day) => (
                      <button
                        key={day.dateIso}
                        type="button"
                        onClick={() => {
                          const [y, m, d] = day.dateIso.split("-").map(Number);
                          setSelectedDate(new Date(y, m - 1, d, 12, 0, 0));
                        }}
                        className={`w-10 py-1.5 rounded-full flex flex-col items-center justify-center transition-all cursor-pointer ${
                          day.isSelected
                            ? "bg-[#a8c7fa] text-[#041e49] font-semibold shadow-2xs"
                            : "hover:bg-[#f1f3f4] text-[#444746]"
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
                    onClick={() => setSelectedDate((d) => shiftDateByDays(d, 7))}
                    aria-label="Próxima semana"
                    className="w-8 h-8 rounded-full hover:bg-[#f1f3f4] flex items-center justify-center text-[#444746] cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Security & Unlimited Info Banner — Faithful to Screenshot 1 */}
              <div className="bg-[#e8f0fe] rounded-full px-5 py-3.5 flex items-center justify-between gap-4 mb-12">
                <div className="flex items-center gap-3.5">
                  <div className="w-8 h-8 rounded-full bg-[#1a73e8] text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="text-xs sm:text-[13px] leading-snug">
                    <div className="font-semibold text-[#1f1f1f]">
                      Sua reunião está segura • Duração e Gravação 100% Sem Limites (∞)
                    </div>
                    <div className="text-[#444746]">
                      As pessoas só podem participar de uma reunião se o organizador convidar ou permitir — sem limite de 1 hora.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSecurityModal(true)}
                  className="shrink-0 bg-white/80 hover:bg-white text-[#1f1f1f] border border-[#dadce0] rounded-full px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                >
                  Saiba mais
                </button>
              </div>

              {/* Scheduled Meetings or Empty State Illustration */}
              {todaysMeetings.length === 0 ? (
                <div className="text-center pt-6 pb-10">
                  <MeetEmptyIllustration />
                  <h2 className="text-[22px] font-normal text-[#1f1f1f] mt-4">
                    Nenhuma reunião agendada para hoje
                  </h2>
                  <p className="text-sm text-[#5f6368] mt-1.5 mb-6">
                    Agende uma reunião ou aproveite seu tempo livre
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleStartInstantMeeting}
                      className="h-11 px-6 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>Nova</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenScheduleModal}
                      className="h-11 px-5 rounded-full bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#1f1f1f] text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Calendar className="w-4 h-4 text-[#0b57d0]" />
                      <span>Agendar horário</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">
                      Reuniões agendadas ({todaysMeetings.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleOpenScheduleModal}
                      className="text-xs font-medium text-[#0b57d0] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Nova reunião neste dia
                    </button>
                  </div>

                  {todaysMeetings.map((mtg) => (
                    <div
                      key={mtg.id}
                      className="border border-[#dadce0] hover:border-[#0b57d0] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all bg-white shadow-2xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-semibold text-[#0b57d0] bg-[#e8f0fe] px-2.5 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {mtg.startTime} • {mtg.endTime}
                          </span>
                          <span className="text-xs font-medium bg-[#e6f4ea] text-[#137333] px-2.5 py-0.5 rounded-full">
                            Gravação ∞ Liberada
                          </span>
                        </div>
                        <h3 className="text-base font-medium text-[#1f1f1f]">
                          {mtg.title}
                        </h3>
                        <p className="text-xs text-[#5f6368]">
                          Código: <code className="font-mono text-[#1f1f1f]">{mtg.roomCode}</code> •{" "}
                          {mtg.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(
                              formatShareableLink(
                                mtg.roomCode,
                                typeof window !== "undefined" ? window.location.origin : undefined
                              )
                            )
                          }
                          className="px-3 py-2 rounded-full border border-[#dadce0] hover:bg-[#f1f3f4] text-xs font-medium text-[#444746] flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copiar link
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMeeting(mtg.id)}
                          aria-label="Excluir reunião"
                          className="p-2 rounded-full hover:bg-[#fce8e6] text-[#d93025] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/room/${mtg.roomCode}`)}
                          className="px-5 py-2 rounded-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-medium cursor-pointer"
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
              <div className="bg-[#f8f9fa] border border-[#dadce0] rounded-3xl p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-[#c2e7ff] text-[#001d35] flex items-center justify-center mx-auto mb-4">
                  <Phone className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-medium text-[#1f1f1f]">
                  Ligações Diretas P2P Sem Limite de Tempo
                </h2>
                <p className="text-sm text-[#5f6368] max-w-md mx-auto mt-2 mb-6">
                  Inicie uma chamada direta WebRTC com áudio e vídeo em alta definição, compartilhamento de tela e gravação contínua.
                </p>
                <div className="flex justify-center gap-3">
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
                    onClick={() => router.push("/room/amd-wraw-qkg")}
                    className="h-11 px-6 rounded-full bg-[#c4eed0] hover:bg-[#b3e5c1] text-[#0f5223] text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                  >
                    Entrar na Sala Demo (amd-wraw-qkg)
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeNav === "recordings" && (
            <div className="py-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-medium text-[#1f1f1f] flex items-center gap-2">
                    <Disc className="w-5 h-5 text-[#0f5223]" />
                    Cofre de Gravações Ilimitadas (IndexedDB)
                  </h2>
                  <p className="text-xs text-[#5f6368] mt-0.5">
                    Todas as gravações são salvas localmente em chunks contínuos de 1 segundo, sem limite de 1 hora.
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
                <div className="border border-dashed border-[#dadce0] rounded-2xl p-10 text-center text-sm text-[#5f6368]">
                  Nenhuma gravação salva ainda. Entre em uma reunião e clique no botão{" "}
                  <strong className="text-[#1f1f1f]">Gravar ∞</strong> na barra inferior para gravar sem limite de tempo!
                </div>
              ) : (
                <div className="space-y-3">
                  {recordings.map((rec) => (
                    <div
                      key={rec.sessionId}
                      className="border border-[#dadce0] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#1f1f1f]">
                            {rec.title}
                          </span>
                          <span className="text-xs bg-[#e6f4ea] text-[#137333] px-2 py-0.5 rounded-full font-medium">
                            {formatUnlimitedDuration(rec.durationSeconds)} •{" "}
                            {formatRecordingBytes(rec.totalBytes)}
                          </span>
                        </div>
                        <div className="text-xs text-[#5f6368] mt-1">
                          Sala: <code>{rec.roomCode}</code> • {rec.chunkCount} chunks gravados •{" "}
                          {new Date(rec.startedAtIso).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
        </main>
      </div>

      {/* MODAL 1: "Veja o link da sua reunião" (Criar reunião para depois) */}
      {laterRoomCode && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-[#1f1f1f]">
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
              Copie este link e envie para as pessoas com quem você quer se reunir. Esta sala possui duração e gravação ilimitadas (∞).
            </p>
            <div className="bg-[#f1f3f4] rounded-xl px-4 py-3 flex items-center justify-between gap-2 mb-5">
              <span className="text-sm font-mono text-[#1f1f1f] truncate">
                {formatShareableLink(
                  laterRoomCode,
                  typeof window !== "undefined" ? window.location.origin : undefined
                )}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    formatShareableLink(
                      laterRoomCode,
                      typeof window !== "undefined" ? window.location.origin : undefined
                    )
                  )
                }
                className="p-2 rounded-full hover:bg-[#e0e2e5] text-[#1f1f1f] cursor-pointer shrink-0"
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
                  router.push(`/room/${code}`);
                }}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0842a0] cursor-pointer"
              >
                Entrar agora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Agendar Reunião Sem Limite */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSaveScheduledMeeting}
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#1f1f1f]">
                Agendar Reunião FREETING (∞)
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
                Duração configurada como <strong>Ilimitada (Sem corte de 60 min)</strong> com gravação local em chunks habilitada.
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

      {/* MODAL 3: Anotações feitas por IA & Estúdio Sem Limites */}
      {showAiNotesModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#d3e3fd] text-[#0b57d0] flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-medium text-[#1f1f1f]">
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
              No <strong>FREETING</strong>, o assistente de IA em Português e a gravação contínua estão liberados gratuitamente em todas as salas, sem o limite de 60 minutos do Google Meet.
            </p>
            <ul className="space-y-2.5 text-xs text-[#444746] bg-[#f8f9fa] p-4 rounded-2xl border border-[#dadce0]">
              <li>• <strong>Gravação Contínua em Chunks (1s):</strong> Salva áudio mixado + vídeo diretamente no IndexedDB sem estourar a memória RAM.</li>
              <li>• <strong>Transcrição ao Vivo (pt-BR):</strong> Reconhecimento de voz contínuo com identificação de orador.</li>
              <li>• <strong>Exportação Instantânea:</strong> Baixe o vídeo `.webm` e a Ata completa em Markdown (`.md`) ao encerrar.</li>
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
                onClick={() => {
                  setShowAiNotesModal(false);
                  router.push("/room/amd-wraw-qkg");
                }}
                className="px-5 py-2 rounded-full bg-[#0b57d0] text-white text-sm font-medium hover:bg-[#0842a0] cursor-pointer"
              >
                Testar na Sala amd-wraw-qkg
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Segurança & Engenharia Reversa REA */}
      {showSecurityModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#1f1f1f] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#1a73e8]" />
                Segurança & Engenharia Reversa (REA + Superpowers)
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
                O <strong>FREETING</strong> foi projetado via engenharia reversa limpa do Google Meet utilizando o <strong>REA (Reverse Engineer Anything)</strong> e a arquitetura <strong>Superpowers</strong>:
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                <div className="p-3 rounded-xl bg-[#fce8e6] text-[#c5221f]">
                  <div className="font-bold mb-1">Google Meet Gratuito</div>
                  <div>• Limite rígido de 60 min em grupo</div>
                  <div>• Gravação bloqueada no plano grátis</div>
                  <div>• Sem download local imediato em WebM</div>
                </div>
                <div className="p-3 rounded-xl bg-[#e6f4ea] text-[#137333]">
                  <div className="font-bold mb-1">FREETING (Sem Limites)</div>
                  <div>• Duração 100% Ilimitada (∞ horas)</div>
                  <div>• Gravação chunked IndexedDB nativa</div>
                  <div>• IA em Português + Download .webm/.md</div>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#1f1f1f] flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#5f6368]" />
                Configurações de Áudio, Vídeo e Gravação
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
                  <div className="font-medium">Microfone Padrão do Sistema</div>
                  <div className="text-xs text-[#5f6368]">Mixagem Web Audio API multi-participante ativa</div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#f8f9fa] border border-[#dadce0] flex items-center gap-3">
                <Camera className="w-5 h-5 text-[#0b57d0]" />
                <div>
                  <div className="font-medium">Câmera HD / Compositor Canvas 720p</div>
                  <div className="text-xs text-[#5f6368]">Fallback automático para gravação mesmo sem webcam</div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#e6f4ea] border border-[#ceead6] flex items-center gap-3">
                <Disc className="w-5 h-5 text-[#137333]" />
                <div>
                  <div className="font-medium text-[#137333]">Motor UnlimitedRecorderEngine</div>
                  <div className="text-xs text-[#137333]">Flush contínuo a cada 1000ms (Sem limite de 1 hora)</div>
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
