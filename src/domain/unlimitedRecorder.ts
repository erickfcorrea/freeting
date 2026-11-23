export const MAX_MEETING_DURATION_MS = Number.POSITIVE_INFINITY;
export const MAX_RECORDING_DURATION_MS = Number.POSITIVE_INFINITY;
export const DEFAULT_RECORDING_TIMESLICE_MS = 1000;

export type VideoCallState =
  | "DEVICE_CHECK"
  | "WAITING_ROOM"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "FAILED"
  | "COMPLETED";

export type RecordingState = "IDLE" | "RECORDING" | "PAUSED" | "SAVING" | "COMPLETED";

export interface UnlimitedRecordingSession {
  sessionId: string;
  roomCode: string;
  state: RecordingState;
  chunkCount: number;
  totalBytes: number;
  startedAtMs: number;
  lastResumedAtMs: number | null;
  accumulatedMs: number;
  timesliceMs: number;
  mimeType: string;
}

/**
 * Formats any elapsed duration in seconds without ANY 60-minute limit.
 * Always displays HH:MM:SS when >= 3600s (1 hour+) or when alwaysHours is true.
 */
export function formatUnlimitedDuration(
  elapsedSeconds: number,
  alwaysHours = true
): string {
  const safeSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (alwaysHours || hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function formatRecordingBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  if (safe < 1024 * 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(2)} MB`;
  return `${(safe / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function createRecordingSession(
  roomCode: string,
  nowMs: number = Date.now(),
  mimeType = "video/webm;codecs=vp8,opus"
): UnlimitedRecordingSession {
  return {
    sessionId: `rec_${roomCode}_${nowMs}`,
    roomCode,
    state: "RECORDING",
    chunkCount: 0,
    totalBytes: 0,
    startedAtMs: nowMs,
    lastResumedAtMs: nowMs,
    accumulatedMs: 0,
    timesliceMs: DEFAULT_RECORDING_TIMESLICE_MS,
    mimeType,
  };
}

export function getEffectiveRecordingDurationMs(
  session: UnlimitedRecordingSession,
  nowMs: number = Date.now()
): number {
  if (session.state === "RECORDING" && session.lastResumedAtMs !== null) {
    return session.accumulatedMs + Math.max(0, nowMs - session.lastResumedAtMs);
  }
  return session.accumulatedMs;
}

export function appendRecordingChunk(
  session: UnlimitedRecordingSession,
  chunkByteLength: number
): UnlimitedRecordingSession {
  if (session.state !== "RECORDING" && session.state !== "PAUSED") {
    return session;
  }
  return {
    ...session,
    chunkCount: session.chunkCount + 1,
    totalBytes: session.totalBytes + Math.max(0, chunkByteLength),
  };
}

export function pauseRecordingSession(
  session: UnlimitedRecordingSession,
  nowMs: number = Date.now()
): UnlimitedRecordingSession {
  if (session.state !== "RECORDING") return session;
  const elapsedSinceResume =
    session.lastResumedAtMs !== null ? Math.max(0, nowMs - session.lastResumedAtMs) : 0;
  return {
    ...session,
    state: "PAUSED",
    accumulatedMs: session.accumulatedMs + elapsedSinceResume,
    lastResumedAtMs: null,
  };
}

export function resumeRecordingSession(
  session: UnlimitedRecordingSession,
  nowMs: number = Date.now()
): UnlimitedRecordingSession {
  if (session.state !== "PAUSED") return session;
  return {
    ...session,
    state: "RECORDING",
    lastResumedAtMs: nowMs,
  };
}

export function finalizeRecordingSession(
  session: UnlimitedRecordingSession,
  nowMs: number = Date.now()
): UnlimitedRecordingSession {
  const totalMs = getEffectiveRecordingDurationMs(session, nowMs);
  return {
    ...session,
    state: "COMPLETED",
    accumulatedMs: totalMs,
    lastResumedAtMs: null,
  };
}

export interface StoppableStream {
  getTracks: () => Array<{ stop: () => void }>;
}

export function releaseMediaStream(stream: StoppableStream | null | undefined): number {
  if (!stream || typeof stream.getTracks !== "function") return 0;
  const tracks = stream.getTracks();
  tracks.forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore already stopped tracks
    }
  });
  return tracks.length;
}
