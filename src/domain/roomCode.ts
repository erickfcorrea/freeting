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

  // 1. Check query parameter ?room=xxx-xxxx-xxx if a full URL was pasted
  try {
    if (trimmed.includes("?room=") || trimmed.includes("&room=")) {
      const matchParam = trimmed.match(/[?&]room=([a-z0-9-_]+)/);
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

  // 5. Flexible custom room code / slug (e.g. "sala-1", "daily", "projeto2026")
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
  const normalized = extractRoomCode(code) ?? code.trim().toLowerCase();
  if (origin) {
    const base = origin.replace(/\/$/, "");
    return `${base}/?room=${normalized}`;
  }
  return `https://freeting.vercel.app/?room=${normalized}`;
}
