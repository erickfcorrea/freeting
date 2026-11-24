const ROOM_ALPHABET = "abcdefghijkmnopqrstuvwxyz";

export const ROOM_CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/**
 * Gera inteiro aleatório criptograficamente seguro sem viés de módulo (CSPRNG — Web Crypto API, CWE-338 mitigation).
 */
function cryptoRandomIndex(maxExclusive: number): number {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const maxUnbiased = Math.floor(256 / maxExclusive) * maxExclusive;
    const buf = new Uint8Array(1);
    do {
      globalThis.crypto.getRandomValues(buf);
    } while (buf[0] >= maxUnbiased);
    return buf[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

function randomLetters(
  length: number,
  customRng?: () => number
): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    const idx = customRng
      ? Math.floor(customRng() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length
      : cryptoRandomIndex(ROOM_ALPHABET.length);
    result += ROOM_ALPHABET[idx];
  }
  return result;
}

export function generateRoomCode(customRng?: () => number): string {
  return `${randomLetters(3, customRng)}-${randomLetters(4, customRng)}-${randomLetters(3, customRng)}`;
}

/**
 * Gera identificador de sessão/participante imprevisível com entropia CSPRNG de 64 bits.
 */
export function generateSecurePeerId(prefix = "peer"): string {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${prefix}_${hex}`;
  }
  return `${prefix}_${Date.now().toString(36)}`;
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_REGEX.test(code.trim().toLowerCase());
}

export function extractRoomCode(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase().slice(0, 256);
  if (!trimmed) return null;

  // 1. Check query parameter ?room=xxx-xxxx-xxx if a full URL was pasted
  try {
    if (trimmed.includes("?room=") || trimmed.includes("&room=")) {
      const matchParam = trimmed.match(/[?&]room=([a-z0-9-_]{2,32})/);
      if (matchParam && matchParam[1]) {
        return matchParam[1];
      }
    }
  } catch {
    // ignore URL parse error
  }

  // 2. Direct match: amd-wraw-qkg
  if (ROOM_CODE_REGEX.test(trimmed)) {
    return trimmed;
  }

  // 3. Raw 10 letters without hyphens: amdwrawqkg -> amd-wraw-qkg
  if (/^[a-z]{10}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 7)}-${trimmed.slice(7, 10)}`;
  }

  // 4. Extract embedded xxx-xxxx-xxx from any URL or text
  const embeddedMatch = trimmed.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  if (embeddedMatch && embeddedMatch[1]) {
    return embeddedMatch[1];
  }

  // 5. Flexible custom room code / slug (sanitized strictly to [a-z0-9-_])
  const cleaned = trimmed
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^freeting\//, "")
    .replace(/^room\//, "")
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (cleaned.length >= 2) {
    if (/^[a-z]{10}$/.test(cleaned)) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 10)}`;
    }
    return cleaned.slice(0, 32);
  }

  return null;
}

export function formatShareableLink(code: string, origin?: string): string {
  const normalized = extractRoomCode(code) ?? "amd-wraw-qkg";
  if (origin && /^https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(origin.replace(/\/$/, ""))) {
    const base = origin.replace(/\/$/, "");
    return `${base}/?room=${encodeURIComponent(normalized)}`;
  }
  return `https://freeting.vercel.app/?room=${encodeURIComponent(normalized)}`;
}
