"use client";

import React, { useEffect, useState } from "react";
import {
  Play,
  Pause,
  MonitorUp,
  Disc,
  ShieldCheck,
  Sparkles,
  Mic,
  Check,
  Maximize2,
  ArrowRight,
} from "lucide-react";

interface StudioChapter {
  id: "instant" | "antimirror" | "vault";
  step: string;
  title: string;
  subtitle: string;
  badge: string;
  durationMs: number;
}

const STUDIO_CHAPTERS: StudioChapter[] = [
  {
    id: "instant",
    step: "01",
    title: "Sala P2P em 1 clique, zero conta obrigatória",
    subtitle:
      "Gere um código criptográfico CSPRNG e conecte computador e celular (4G/5G + TURN) sem cadastro, senha ou download.",
    badge: "CONEXÃO DIRETA · < 400ms",
    durationMs: 5200,
  },
  {
    id: "antimirror",
    step: "02",
    title: "Apresentação sem espelho infinito e Zoom 200%",
    subtitle:
      "Compartilhe sua tela com escudo LGPD contra vazamento de notificações e zoom nítido para quem assiste.",
    badge: "PALCO ANTI-ESPELHO · HD",
    durationMs: 5200,
  },
  {
    id: "vault",
    step: "03",
    title: "Gravação local sem teto de 60 min + Ata IA",
    subtitle:
      "Grave horas seguidas direto no IndexedDB do seu navegador (.WebM no PC/Android e .MP4 no iPhone) com resumo em Português.",
    badge: "COFRE LOCAL · SEM LIMITE",
    durationMs: 5200,
  },
];

export function FreetingStudioDemoReel({
  isHighContrast = false,
  isLight = false,
  onLaunchStudio,
}: {
  isHighContrast?: boolean;
  isLight?: boolean;
  onLaunchStudio: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [liveRecSec, setLiveRecSec] = useState(6492); // 01:48:12 — proves >60m!

  useEffect(() => {
    if (!isPlaying) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const duration = STUDIO_CHAPTERS[activeIndex].durationMs;
    const tickMs = 60;
    const increment = (tickMs / duration) * 100;

    const id = window.setInterval(() => {
      setProgress((prev) => {
        if (prev + increment >= 100) {
          setActiveIndex((i) => (i + 1) % STUDIO_CHAPTERS.length);
          return 0;
        }
        return prev + increment;
      });
    }, tickMs);

    return () => window.clearInterval(id);
  }, [activeIndex, isPlaying]);

  useEffect(() => {
    if (activeIndex !== 2 || !isPlaying) return;
    const id = window.setInterval(() => {
      setLiveRecSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [activeIndex, isPlaying]);

  const formatClock = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [hrs, mins, secs]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  };

  const current = STUDIO_CHAPTERS[activeIndex];

  const outerShellClass = isHighContrast
    ? "bg-black border-2 border-yellow-400 text-white"
    : isLight
      ? "bg-[#10141D] text-white shadow-[0_28px_70px_-24px_rgba(15,20,25,0.38)] ring-1 ring-black/10"
      : "studio-card-dark text-white ring-1 ring-white/[0.09]";

  return (
    <section
      aria-label="Demonstração interativa em tempo real do estúdio FREETING"
      className={`rounded-[28px] p-3 sm:p-4 transition-colors ${outerShellClass}`}
    >
      {/* Concentric Inner Viewport: R_outer (28px) - Padding (12px) = R_inner (16px) */}
      <div className="relative overflow-hidden rounded-[16px] bg-gradient-to-br from-[#0B0F17] via-[#0E1420] to-[#070A0F] p-4 sm:p-6 ring-1 ring-white/[0.07]">
        {/* Subtle Studio Lighting Glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 right-8 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 left-8 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl"
        />

        {/* Top Studio Telemetry Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wider uppercase ${
                isHighContrast
                  ? "bg-yellow-400 text-black"
                  : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isHighContrast
                    ? "bg-black"
                    : isPlaying
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-slate-400"
                }`}
              />
              {current.badge}
            </span>
            <span className="hidden sm:inline font-mono-tabular text-xs text-slate-400">
              DEMO INTERATIVA · CAPÍTULO {current.step}/03
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              aria-pressed={!isPlaying}
              aria-label={
                isPlaying
                  ? "Pausar demonstração automática"
                  : "Reproduzir demonstração automática"
              }
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition cursor-pointer ${
                isHighContrast
                  ? "border-2 border-yellow-400 bg-black text-yellow-300"
                  : "bg-white/[0.06] text-slate-200 hover:bg-white/[0.12] ring-1 ring-white/10"
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  <span>Pausar</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>Reproduzir</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Main Choreographed Stage */}
        <div className="relative z-10 mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* Left Narrative */}
          <div className="lg:col-span-5 space-y-3">
            <div className="font-mono-tabular text-xs font-semibold tracking-widest text-emerald-400 uppercase">
               Fluxo Ao Vivo · Etapa {current.step}
            </div>
            <h3 className="font-display text-xl sm:text-2xl font-bold leading-tight text-white text-balance">
              {current.title}
            </h3>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-300">
              {current.subtitle}
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={onLaunchStudio}
                className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                  isHighContrast
                    ? "bg-yellow-400 text-black font-bold"
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/20"
                }`}
              >
                <span>Testar no Estúdio Real</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Right Animated Product Simulation Canvas */}
          <div className="lg:col-span-7">
            {current.id === "instant" && (
              <div className="rounded-2xl bg-[#121824]/95 p-4 ring-1 ring-white/10 space-y-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono-tabular text-emerald-300 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4" />
                    freeting.vercel.app/?room=kpx-vtrm-qnd
                  </span>
                  <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 inline-flex items-center gap-1">
                    <Check className="h-3 w-3" /> Copiado
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#0B0F17] p-3.5 ring-1 ring-emerald-400/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300">
                        Desktop · Organizador
                      </span>
                      <div className="flex items-end gap-0.5 h-3" aria-hidden="true">
                        <span className="w-1 h-full bg-emerald-400 rounded-full animate-eq-1" />
                        <span className="w-1 h-full bg-emerald-400 rounded-full animate-eq-2" />
                        <span className="w-1 h-full bg-emerald-400 rounded-full animate-eq-3" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-300 font-display font-bold flex items-center justify-center ring-1 ring-emerald-400/30">
                        ÉF
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">
                          Érick (Estúdio PC)
                        </div>
                        <div className="text-[11px] text-emerald-400 font-mono-tabular">
                          HD 1080p · Voz ativa
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#0B0F17] p-3.5 ring-1 ring-white/10 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300">
                        Smartphone · 5G TURN
                      </span>
                      <Mic className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-10 rounded-xl bg-amber-500/20 text-amber-300 font-display font-bold flex items-center justify-center ring-1 ring-amber-400/30">
                        CM
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">
                          Dra. Camila (iOS)
                        </div>
                        <div className="text-[11px] text-amber-300 font-mono-tabular">
                          Sem login · Conectada
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {current.id === "antimirror" && (
              <div className="rounded-2xl bg-[#121824]/95 p-4 ring-1 ring-white/10 space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                    <MonitorUp className="h-4 w-4" />
                    Palco Anti-Espelho Infinito Ativo
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono-tabular text-[11px] text-white inline-flex items-center gap-1">
                      <Maximize2 className="h-3 w-3 text-amber-300" />
                      Zoom 150%
                    </span>
                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                      Escudo LGPD ON
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-2.5 items-stretch">
                  <div className="col-span-8 rounded-xl bg-[#090D14] p-3.5 ring-1 ring-white/10 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Arquitetura_Produto_Q4.fig</span>
                      <span className="font-mono-tabular text-emerald-400">60 FPS · Detalhe</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="h-14 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/30 p-2">
                        <div className="h-2 w-10 rounded bg-emerald-400/70" />
                        <div className="mt-2 h-5 w-full rounded bg-white/10" />
                      </div>
                      <div className="h-14 rounded-lg bg-amber-500/15 ring-1 ring-amber-400/30 p-2">
                        <div className="h-2 w-8 rounded bg-amber-400/80" />
                        <div className="mt-2 h-5 w-full rounded bg-white/10" />
                      </div>
                      <div className="h-14 rounded-lg bg-white/[0.05] ring-1 ring-white/10 p-2">
                        <div className="h-2 w-12 rounded bg-slate-400/60" />
                        <div className="mt-2 h-5 w-full rounded bg-white/10" />
                      </div>
                    </div>
                  </div>
                  <div className="col-span-4 flex flex-col justify-between rounded-xl bg-[#090D14] p-3 ring-1 ring-white/10 text-[11px]">
                    <span className="text-slate-400">Sem loop visual</span>
                    <span className="font-semibold text-white">
                      GPU poupada + notificações privadas ocultas
                    </span>
                  </div>
                </div>
              </div>
            )}

            {current.id === "vault" && (
              <div className="rounded-2xl bg-[#121824]/95 p-4 ring-1 ring-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-rose-500/20 px-3 py-1 font-mono-tabular text-xs font-semibold text-rose-300 ring-1 ring-rose-400/35">
                    <Disc className="h-3.5 w-3.5 animate-spin" />
                    REC {formatClock(liveRecSec)} · SEM CORTE DE 60 MIN
                  </span>
                  <span className="font-mono-tabular text-[11px] text-slate-400">
                    IndexedDB Local · .MP4 / .WebM
                  </span>
                </div>

                <div className="rounded-xl bg-[#090D14] p-3.5 ring-1 ring-white/10 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Ata Inteligente em Português (DLP LGPD Ativo)
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    • Decisões consolidadas automaticamente ao encerrar a chamada, com mascaramento de CPF/e-mail e download imediato em Markdown.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Chapter Scrubber Controls */}
      <div
        role="tablist"
        aria-label="Capítulos da demonstração"
        className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2"
      >
        {STUDIO_CHAPTERS.map((chap, idx) => {
          const isCurrent = idx === activeIndex;
          return (
            <button
              key={chap.id}
              type="button"
              role="tab"
              aria-selected={isCurrent}
              onClick={() => {
                setActiveIndex(idx);
                setProgress(0);
              }}
              className={`rounded-[16px] p-3 text-left transition cursor-pointer ${
                isCurrent
                  ? "bg-white/[0.1] ring-1 ring-emerald-400/40"
                  : "bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className={`h-full transition-[width] duration-75 ${
                    isHighContrast ? "bg-yellow-400" : "bg-emerald-400"
                  }`}
                  style={{
                    width: isCurrent
                      ? `${progress}%`
                      : idx < activeIndex
                        ? "100%"
                        : "0%",
                  }}
                />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono-tabular text-[11px] font-bold text-emerald-400">
                  {chap.step}
                </span>
                <span className="truncate text-xs font-semibold text-white">
                  {chap.title}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
