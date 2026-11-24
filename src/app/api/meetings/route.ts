import { NextRequest, NextResponse } from "next/server";
import { generateRoomCode } from "@/domain/roomCode";
import {
  listMeetingsFromDb,
  createMeetingInDb,
  deleteMeetingFromDb,
} from "@/services/sqliteDatabase";
import {
  SlidingWindowRateLimiter,
  validateAndSanitizeMeetingInput,
  sanitizeSafeText,
} from "@/domain/securityGuard";

const MAX_BODY_BYTES = 16_384; // 16 KB anti-DoS cap
const apiMutationLimiter = new SlidingWindowRateLimiter(30, 60_000);

const SECURITY_JSON_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Verifica integridade Same-Origin (CSRF Defense) em mutações POST/DELETE.
 */
function isTrustedSameOrigin(req: NextRequest): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (
    secFetchSite &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "none"
  ) {
    return false;
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Identificador efêmero não reversível para rate-limit (LGPD Art. 6º, III — sem gravar IP em disco ou log).
 */
function getAnonymousRateKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") || "local";
  const firstHop = forwarded.split(",")[0]?.trim() || "local";
  let hash = 2166136261;
  for (let i = 0; i < firstHop.length; i++) {
    hash ^= firstHop.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `rl_${(hash >>> 0).toString(16)}`;
}

export async function GET() {
  const { meetings } = listMeetingsFromDb();
  return NextResponse.json(
    {
      platform: "FREETING",
      meetings,
    },
    { headers: SECURITY_JSON_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  if (!isTrustedSameOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: "Origem da requisição não autorizada." },
      { status: 403, headers: SECURITY_JSON_HEADERS }
    );
  }

  if (!apiMutationLimiter.allow(getAnonymousRateKey(req))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Muitas requisições em sequência. Aguarde alguns segundos.",
      },
      {
        status: 429,
        headers: { ...SECURITY_JSON_HEADERS, "Retry-After": "15" },
      }
    );
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Payload excede o limite permitido." },
      { status: 413, headers: SECURITY_JSON_HEADERS }
    );
  }

  try {
    const rawText = await req.text();
    if (rawText.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Payload excede o limite permitido." },
        { status: 413, headers: SECURITY_JSON_HEADERS }
      );
    }

    const parsed: unknown = rawText ? JSON.parse(rawText) : {};
    const validated = validateAndSanitizeMeetingInput(
      parsed,
      generateRoomCode()
    );

    if (!validated) {
      return NextResponse.json(
        { ok: false, error: "Formato de agendamento inválido." },
        { status: 400, headers: SECURITY_JSON_HEADERS }
      );
    }

    createMeetingInDb(validated);
    const { meetings } = listMeetingsFromDb();
    return NextResponse.json(
      { ok: true, meeting: validated, meetings },
      { headers: SECURITY_JSON_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível processar os dados enviados." },
      { status: 400, headers: SECURITY_JSON_HEADERS }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isTrustedSameOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: "Origem da requisição não autorizada." },
      { status: 403, headers: SECURITY_JSON_HEADERS }
    );
  }

  if (!apiMutationLimiter.allow(getAnonymousRateKey(req))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Muitas requisições em sequência. Aguarde alguns segundos.",
      },
      {
        status: 429,
        headers: { ...SECURITY_JSON_HEADERS, "Retry-After": "15" },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawId = sanitizeSafeText(searchParams.get("id"), 48);
  if (!rawId || !/^[a-zA-Z0-9_-]{3,48}$/.test(rawId)) {
    return NextResponse.json(
      { ok: false, error: "Identificador de reunião inválido." },
      { status: 400, headers: SECURITY_JSON_HEADERS }
    );
  }

  deleteMeetingFromDb(rawId);
  const { meetings } = listMeetingsFromDb();
  return NextResponse.json(
    { ok: true, meetings },
    { headers: SECURITY_JSON_HEADERS }
  );
}
