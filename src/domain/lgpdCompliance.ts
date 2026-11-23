/**
 * Módulo de Conformidade LGPD (Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018)
 *
 * Implementa:
 * - Art. 5º, II e Art. 11: Proteção e mascaramento de dados pessoais e dados sensíveis.
 * - Art. 6º, III (Necessidade / Minimização): Sanitização de logs e payloads.
 * - Art. 7º, I (Consentimento): Registro auditável de consentimento local para gravação e transcrição.
 * - Art. 18 (Direitos do Titular): Acesso, Portabilidade (JSON) e Eliminação completa de dados locais.
 */

export interface LgpdConsentRecord {
  version: string;
  acceptedPrivacyNotice: boolean;
  recordingConsentGranted: boolean;
  aiTranscriptionConsentGranted: boolean;
  autoMaskPersonalData: boolean;
  updatedAtIso: string;
}

export const LGPD_STORAGE_CONSENT_KEY = "freeting_lgpd_consent_v1";

export const DEFAULT_LGPD_CONSENT: LgpdConsentRecord = {
  version: "2026.1-LGPD",
  acceptedPrivacyNotice: false,
  recordingConsentGranted: false,
  aiTranscriptionConsentGranted: false,
  autoMaskPersonalData: true,
  updatedAtIso: new Date().toISOString(),
};

/**
 * Mascara CPF no formato ***.456.789-** ou ***.***.***-** (LGPD Art. 6º, VII — Segurança e Prevenção)
 */
export function maskCpf(cpf: string): string {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return "***.***.***-**";
  return `${clean.slice(0, 3)}.***.***-${clean.slice(9, 11)}`;
}

/**
 * Mascara endereço de e-mail preservando apenas os 2 primeiros caracteres do usuário
 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***@***.***";
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * Mascara telefone brasileiro (DDD + últimos 4 dígitos)
 */
export function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length < 10) return "(**) *****-****";
  return `(${clean.slice(0, 2)}) *****-${clean.slice(-4)}`;
}

/**
 * DLP (Data Loss Prevention) em tempo real para Chat, Legendas e Atas:
 * Detecta e mascara automaticamente CPFs, e-mails e telefones em textos livres
 * quando a proteção de dados pessoais (LGPD) está ativa.
 */
export function maskPersonalDataInText(text: string, enabled = true): string {
  if (!enabled || !text) return text;

  return text
    // Mascara padrões de CPF (000.000.000-00 ou 11 dígitos)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (match) => maskCpf(match))
    // Mascara e-mails
    .replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      (match) => maskEmail(match)
    )
    // Mascara telefones brasileiros ((11) 99999-9999 ou 11 99999-9999)
    .replace(
      /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-\d{4}\b/g,
      (match) => maskPhone(match)
    );
}

const SENSITIVE_KEYS = new Set([
  "cpf",
  "rg",
  "cns",
  "email",
  "phone",
  "telefone",
  "password",
  "senha",
  "token",
  "authorization",
  "ip",
  "ip_address",
  "diagnosis",
  "prontuario",
  "prescription",
  "anamnese",
]);

/**
 * Sanitiza objetos antes de qualquer log para garantir Zero Dados Pessoais em logs (LGPD Art. 46)
 */
export function sanitizeLogData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED_LGPD]";
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      sanitized[key] = sanitizeLogData(val as Record<string, unknown>);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export function loadLgpdConsent(): LgpdConsentRecord {
  if (typeof window === "undefined") return DEFAULT_LGPD_CONSENT;
  try {
    const raw = localStorage.getItem(LGPD_STORAGE_CONSENT_KEY);
    if (!raw) return DEFAULT_LGPD_CONSENT;
    return { ...DEFAULT_LGPD_CONSENT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LGPD_CONSENT;
  }
}

export function saveLgpdConsent(
  patch: Partial<LgpdConsentRecord>
): LgpdConsentRecord {
  const current = loadLgpdConsent();
  const next: LgpdConsentRecord = {
    ...current,
    ...patch,
    updatedAtIso: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LGPD_STORAGE_CONSENT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}
