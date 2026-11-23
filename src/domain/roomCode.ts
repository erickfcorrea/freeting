const ROOM_ALPHABET = "abcdefghijkmnopqrstuvwxyz";

export const ROOM_CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function randomLetters(length: number, rng: () => number = Math.random): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(rng() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length;
    result += ROOM_ALPHABET[idx];
  }
  return result;
}

export function generateRoomCode(rng: () => number = Math.random): string {
  return `${randomLetters(3, rng)}-${randomLetters(4, rng)}-${randomLetters(3, rng)}`;
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_REGEX.test(code.trim().toLowerCase());
}

export function extractRoomCode(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Direct match: amd-wraw-qkg
  if (ROOM_CODE_REGEX.test(trimmed)) {
    return trimmed;
  }

  // Raw 10 letters without hyphens: amdwrawqkg
  if (/^[a-z]{10}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 7)}-${trimmed.slice(7, 10)}`;
  }

  // Extract from URL or string containing xxx-xxxx-xxx (e.g., https://meet.google.com/amd-wraw-qkg?pli=1)
  const embeddedMatch = trimmed.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  if (embeddedMatch && embeddedMatch[1]) {
    return embeddedMatch[1];
  }

  // Custom slug fallback: sanitize alphanumeric slug into valid room identifier
  const cleaned = trimmed
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^room\//, "")
    .replace(/\?.*$/, "")
    .replace(/[^a-z0-9-]/g, "");

  if (ROOM_CODE_REGEX.test(cleaned)) {
    return cleaned;
  }
  if (/^[a-z]{10}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 10)}`;
  }

  return null;
}

export function formatShareableLink(code: string, origin?: string): string {
  const normalized = extractRoomCode(code) ?? code.trim().toLowerCase();
  if (origin) {
    return `${origin.replace(/\/$/, "")}/room/${normalized}`;
  }
  return `freeting.app/${normalized}`;
}
