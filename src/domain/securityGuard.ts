import { maskPersonalDataInText } from "./lgpdCompliance";

const DANGEROUS_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Remove caracteres de controle ASCII, bytes nulos e overrides bidirecionais Unicode (anti-spoofing visual),
 * limitando o comprimento máximo para prevenir ataques de exaustão de memória (DoS).
 */
export function sanitizeSafeText(input: unknown, maxLength = 500): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitiza nomes de arquivos para download local impedindo Path Traversal (`../`) e caracteres inválidos.
 */
export function sanitizeDownloadFilename(filename: string): string {
  const cleaned = filename
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  return cleaned || "arquivo-freeting";
}

/**
 * Verifica recursivamente se um objeto vindo de rede/JSON/DataChannel não contém chaves de Prototype Pollution.
 */
export function isPrototypeSafeObject(
  value: unknown,
  depth = 0
): value is Record<string, unknown> {
  if (depth > 5 || typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      return false;
    }
    const prop = (value as Record<string, unknown>)[key];
    if (typeof prop === "object" && prop !== null && !Array.isArray(prop)) {
      if (!isPrototypeSafeObject(prop, depth + 1)) return false;
    }
  }
  return true;
}

/**
 * Limitador de taxa em janela deslizante (Sliding Window Rate Limiter) para rotas HTTP e DataChannels P2P.
 */
export class SlidingWindowRateLimiter {
  private buckets = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  public allow(key: string, nowMs: number = Date.now()): boolean {
    const cutoff = nowMs - this.windowMs;
    const prev = this.buckets.get(key) || [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= this.maxRequests) {
      this.buckets.set(key, active);
      return false;
    }

    active.push(nowMs);
    this.buckets.set(key, active);

    // Limpeza periódica para evitar crescimento de memória (LGPD Minimização — zero retenção de IP)
    if (this.buckets.size > 1000) {
      for (const [k, timestamps] of this.buckets.entries()) {
        const filtered = timestamps.filter((ts) => ts > cutoff);
        if (filtered.length === 0) {
          this.buckets.delete(k);
        } else {
          this.buckets.set(k, filtered);
        }
      }
    }

    return true;
  }
}

export interface ValidatedMeetingInput {
  id: string;
  title: string;
  roomCode: string;
  dateIso: string;
  startTime: string;
  endTime: string;
  hostName: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  aiNotesEnabled: boolean;
  unlimitedRecordingEnabled: boolean;
  description: string;
}

const VALID_STATUSES = new Set([
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

/**
 * Valida e sanitiza rigorosamente o payload de agendamento na fronteira da API (OWASP Input Validation + LGPD DLP).
 */
export function validateAndSanitizeMeetingInput(
  raw: unknown,
  fallbackRoomCode: string
): ValidatedMeetingInput | null {
  if (!isPrototypeSafeObject(raw)) return null;

  const rawId = sanitizeSafeText(raw.id, 48);
  const safeId = /^[a-zA-Z0-9_-]{3,48}$/.test(rawId)
    ? rawId
    : `mtg_${Date.now()}`;

  const rawTitle = sanitizeSafeText(raw.title, 120) || "Reunião FREETING";
  const safeTitle = maskPersonalDataInText(rawTitle, true);

  const rawCode = sanitizeSafeText(raw.roomCode, 32).toLowerCase();
  const safeRoomCode = /^[a-z0-9-]{2,32}$/.test(rawCode)
    ? rawCode
    : fallbackRoomCode;

  const rawDate = sanitizeSafeText(raw.dateIso, 10);
  const safeDateIso = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);

  const rawStart = sanitizeSafeText(raw.startTime, 5);
  const safeStartTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(rawStart)
    ? rawStart
    : "19:00";

  const rawEnd = sanitizeSafeText(raw.endTime, 16);
  const safeEndTime =
    rawEnd && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawEnd) ? rawEnd : "";

  const rawHost = sanitizeSafeText(raw.hostName, 60) || "Organizador";
  const safeHostName = maskPersonalDataInText(rawHost, true);

  const rawStatus = sanitizeSafeText(raw.status, 16);
  const safeStatus = VALID_STATUSES.has(rawStatus)
    ? (rawStatus as ValidatedMeetingInput["status"])
    : "SCHEDULED";

  const rawDesc = sanitizeSafeText(raw.description, 600);
  const safeDesc = maskPersonalDataInText(rawDesc, true);

  return {
    id: safeId,
    title: safeTitle,
    roomCode: safeRoomCode,
    dateIso: safeDateIso,
    startTime: safeStartTime,
    endTime: safeEndTime,
    hostName: safeHostName,
    status: safeStatus,
    aiNotesEnabled:
      typeof raw.aiNotesEnabled === "boolean" ? raw.aiNotesEnabled : true,
    unlimitedRecordingEnabled:
      typeof raw.unlimitedRecordingEnabled === "boolean"
        ? raw.unlimitedRecordingEnabled
        : true,
    description: safeDesc,
  };
}
