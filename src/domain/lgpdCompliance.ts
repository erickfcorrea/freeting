/**
 * Módulo de Conformidade LGPD (Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018)
 *
 * Implementa:
 * - Art. 5º, II e Art. 11: Proteção e mascaramento de dados pessoais e dados sensíveis.
 * - Art. 6º, III (Necessidade / Minimização): Sanitização de logs, áudio/vídeo P2P efêmero e zero login.
 * - Art. 6º, VII e Art. 46 (Segurança e Prevenção): Escudo de privacidade durante transmissão de tela e DLP.
 * - Art. 7º, I (Consentimento): Registro auditável de consentimento local para gravação e transcrição.
 * - Art. 18 (Direitos do Titular): Acesso, Portabilidade (JSON) e Eliminação completa de dados locais.
 * - Art. 37 (ROPA): Registro transparente das operações de tratamento realizadas localmente no navegador.
 */

export interface LgpdConsentRecord {
  version: string;
  acceptedPrivacyNotice: boolean;
  recordingConsentGranted: boolean;
  aiTranscriptionConsentGranted: boolean;
  autoMaskPersonalData: boolean;
  screenSharePrivacyShield: boolean;
  ipRelayPrivacyMode: boolean;
  updatedAtIso: string;
}

export interface LgpdProcessingOperation {
  id: string;
  feature: string;
  legalBasis: string;
  retention: string;
  protectionMeasure: string;
}

export const LGPD_STORAGE_CONSENT_KEY = "freeting_lgpd_consent_v1";

export const DEFAULT_LGPD_CONSENT: LgpdConsentRecord = {
  version: "2026.2-LGPD",
  acceptedPrivacyNotice: false,
  recordingConsentGranted: false,
  aiTranscriptionConsentGranted: false,
  autoMaskPersonalData: true,
  screenSharePrivacyShield: true,
  ipRelayPrivacyMode: false,
  updatedAtIso: new Date().toISOString(),
};

export const LGPD_ROPA_OPERATIONS: LgpdProcessingOperation[] = [
  {
    id: "webrtc_p2p_media",
    feature: "Áudio, Vídeo e Voz na Sala",
    legalBasis: "Art. 6º, III e VII (Execução efêmera e Segurança)",
    retention: "Zero retenção em servidor (streaming P2P criptografado DTLS-SRTP)",
    protectionMeasure: "Medidor de voz processado 100% em RAM local sem coleta biométrica",
  },
  {
    id: "screen_share_shield",
    feature: "Transmissão de Tela (Anti-Espelho & Escudo)",
    legalBasis: "Art. 6º, VII e Art. 46 (Prevenção de vazamento acidental)",
    retention: "Efêmero em tempo real durante a apresentação",
    protectionMeasure: "Exclusão da própria guia, ocultação de espelho infinito e supressão de popups privados",
  },
  {
    id: "dlp_chat_captions",
    feature: "Chat, Legendas ao Vivo e Atas",
    legalBasis: "Art. 5º, II e Art. 46 (Minimização e DLP)",
    retention: "Apenas em memória durante a sessão da sala",
    protectionMeasure: "Mascaramento automático de CPF, CNPJ, e-mail, telefone e cartão",
  },
  {
    id: "local_recording_vault",
    feature: "Gravação Local da Reunião",
    legalBasis: "Art. 7º, I e Art. 18, V/VI (Consentimento e Controle do Titular)",
    retention: "Armazenado exclusivamente no navegador local do próprio usuário",
    protectionMeasure: "Aviso transparente no chat ao iniciar e exclusão/download sob controle do titular",
  },
];

/**
 * Mascara CPF no formato 123.***.***-45 (LGPD Art. 6º, VII — Segurança e Prevenção)
 */
export function maskCpf(cpf: string): string {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return "***.***.***-**";
  return `${clean.slice(0, 3)}.***.***-${clean.slice(9, 11)}`;
}

/**
 * Mascara CNPJ preservando os dígitos raiz e finais (LGPD Art. 6º, VII)
 */
export function maskCnpj(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return "**.***.***/****-**";
  return `${clean.slice(0, 2)}.***.***/****-${clean.slice(12, 14)}`;
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
 * Mascara numeração de cartão bancário preservando apenas os 4 últimos dígitos
 */
export function maskCardNumber(card: string): string {
  const clean = card.replace(/\D/g, "");
  if (clean.length < 13) return "**** **** **** ****";
  return `**** **** **** ${clean.slice(-4)}`;
}

/**
 * DLP (Data Loss Prevention) em tempo real para Chat, Legendas, IA e Atas:
 * Detecta e mascara automaticamente CPFs, CNPJs, cartões, e-mails e telefones
 * quando a proteção de dados pessoais (LGPD) está ativa.
 */
export function maskPersonalDataInText(text: string, enabled = true): string {
  if (!enabled || !text) return text;

  return text
    // Mascara cartões (4 blocos de 4 dígitos separados por espaço ou hífen)
    .replace(/\b(?:\d{4}[ -]){3}\d{4}\b/g, (match) => maskCardNumber(match))
    // Mascara padrões de CNPJ (00.000.000/0000-00)
    .replace(
      /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
      (match) => maskCnpj(match)
    )
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
  "cnpj",
  "rg",
  "cns",
  "card",
  "cartao",
  "pix",
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
  if (typeof window === "undefined") return next;
  try {
    localStorage.setItem(LGPD_STORAGE_CONSENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
