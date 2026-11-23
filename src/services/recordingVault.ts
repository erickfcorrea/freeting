import {
  UnlimitedRecordingSession,
  createRecordingSession,
  appendRecordingChunk,
  pauseRecordingSession,
  resumeRecordingSession,
  finalizeRecordingSession,
  getEffectiveRecordingDurationMs,
} from "@/domain/unlimitedRecorder";

export interface StoredRecordingMeta {
  sessionId: string;
  roomCode: string;
  title: string;
  startedAtIso: string;
  durationSeconds: number;
  totalBytes: number;
  chunkCount: number;
  mimeType: string;
  transcriptSummary?: string;
}

const DB_NAME = "freeting_unlimited_recordings_db";
const DB_VERSION = 1;
const META_STORE = "recordings_meta";
const CHUNKS_STORE = "recordings_chunks";

function openRecordingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB not available in current environment"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunkStore = db.createObjectStore(CHUNKS_STORE, {
          keyPath: ["sessionId", "chunkIndex"],
        });
        chunkStore.createIndex("by_session", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecordingChunkToVault(
  sessionId: string,
  chunkIndex: number,
  blob: Blob
): Promise<void> {
  try {
    const db = await openRecordingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readwrite");
      tx.objectStore(CHUNKS_STORE).put({
        sessionId,
        chunkIndex,
        blob,
        savedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Fallback handled by in-memory chunks list if IndexedDB is restricted
  }
}

export async function saveRecordingMetaToVault(
  meta: StoredRecordingMeta
): Promise<void> {
  try {
    const db = await openRecordingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore in SSR or private mode
  }
}

export async function listRecordingsFromVault(): Promise<StoredRecordingMeta[]> {
  try {
    const db = await openRecordingsDb();
    const items = await new Promise<StoredRecordingMeta[]>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredRecordingMeta[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => b.startedAtIso.localeCompare(a.startedAtIso));
  } catch {
    return [];
  }
}

export async function assembleRecordingBlobFromVault(
  sessionId: string,
  mimeType = "video/webm"
): Promise<Blob | null> {
  try {
    const db = await openRecordingsDb();
    const rows = await new Promise<
      Array<{ sessionId: string; chunkIndex: number; blob: Blob }>
    >((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, "readonly");
      const index = tx.objectStore(CHUNKS_STORE).index("by_session");
      const req = index.getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!rows.length) return null;
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return new Blob(
      rows.map((r) => r.blob),
      { type: mimeType }
    );
  } catch {
    return null;
  }
}

export async function deleteRecordingFromVault(sessionId: string): Promise<void> {
  try {
    const db = await openRecordingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, CHUNKS_STORE], "readwrite");
      tx.objectStore(META_STORE).delete(sessionId);
      const index = tx.objectStore(CHUNKS_STORE).index("by_session");
      const req = index.openCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * LiveUnlimitedMediaRecorder:
 * Records camera, screen share, or an automatic 30fps live stage canvas compositor
 * + mixed multi-participant Web Audio API tracks with 1-second chunked persistence
 * and ZERO duration limit (works for 1h, 3h, 12h+).
 */
export class LiveUnlimitedMediaRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private session: UnlimitedRecordingSession;
  private memoryChunks: Blob[] = [];
  private syntheticCanvas: HTMLCanvasElement | null = null;
  private syntheticAnimFrame: number | null = null;
  private audioCtx: AudioContext | null = null;
  private compositeStream: MediaStream | null = null;
  private onUpdate: (session: UnlimitedRecordingSession) => void;

  constructor(
    roomCode: string,
    onUpdate: (session: UnlimitedRecordingSession) => void
  ) {
    this.session = createRecordingSession(roomCode);
    this.onUpdate = onUpdate;
  }

  public getSession(): UnlimitedRecordingSession {
    return this.session;
  }

  public async start(options: {
    primaryVideoStream?: MediaStream | null;
    audioStreams?: Array<MediaStream | null | undefined>;
    roomCode: string;
    participantNames: string[];
    getActiveCaption?: () => string;
  }): Promise<UnlimitedRecordingSession> {
    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const selectedMime =
      mimeCandidates.find(
        (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
      ) || "video/webm";

    this.session = createRecordingSession(
      options.roomCode,
      Date.now(),
      selectedMime
    );
    this.memoryChunks = [];

    // Build video track: either real camera/screen stream or 1280x720 live canvas stage
    const combinedTracks: MediaStreamTrack[] = [];
    const realVideoTrack = options.primaryVideoStream
      ?.getVideoTracks()
      .find((t) => t.readyState === "live");

    if (realVideoTrack) {
      combinedTracks.push(realVideoTrack);
    } else if (typeof document !== "undefined") {
      // Create a live 30fps canvas stage so recordings work even when camera is off!
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      this.syntheticCanvas = canvas;
      const ctx = canvas.getContext("2d");

      const renderFrame = () => {
        if (!ctx || !this.syntheticCanvas) return;
        ctx.fillStyle = "#1b3a6b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Header bar
        ctx.fillStyle = "rgba(19, 19, 20, 0.85)";
        ctx.fillRect(0, 0, canvas.width, 64);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 22px sans-serif";
        ctx.fillText(
          `FREETING • Sala ${options.roomCode} • GRAVAÇÃO ILIMITADA ∞`,
          28,
          40
        );

        const elapsedSec = Math.floor(
          getEffectiveRecordingDurationMs(this.session) / 1000
        );
        const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, "0");
        const mm = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, "0");
        const ss = String(elapsedSec % 60).padStart(2, "0");
        ctx.fillStyle = "#f28b82";
        ctx.fillText(`● REC ${hh}:${mm}:${ss}`, canvas.width - 230, 40);

        // Draw participant avatars
        const names = options.participantNames.length
          ? options.participantNames
          : ["Você (Organizador)"];
        const step = canvas.width / (names.length + 1);
        names.forEach((name, idx) => {
          const cx = step * (idx + 1);
          const cy = canvas.height / 2;

          ctx.beginPath();
          ctx.arc(cx, cy, 68, 0, Math.PI * 2);
          ctx.fillStyle = idx % 2 === 0 ? "#0b57d0" : "#0f5223";
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 40px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(name.charAt(0).toUpperCase(), cx, cy + 14);

          ctx.font = "20px sans-serif";
          ctx.fillText(name, cx, cy + 110);
          ctx.textAlign = "left";
        });

        // Draw live caption if any
        const caption = options.getActiveCaption?.();
        if (caption) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
          ctx.fillRect(140, canvas.height - 110, canvas.width - 280, 64);
          ctx.fillStyle = "#ffffff";
          ctx.font = "22px sans-serif";
          ctx.fillText(caption.slice(0, 85), 165, canvas.height - 70);
        }

        this.syntheticAnimFrame = requestAnimationFrame(renderFrame);
      };
      renderFrame();

      const canvasStream = canvas.captureStream(30);
      canvasStream.getVideoTracks().forEach((t) => combinedTracks.push(t));
    }

    // Mix all available audio streams using Web Audio API AudioContext
    if (typeof window !== "undefined" && "AudioContext" in window) {
      try {
        const audioCtx = new window.AudioContext();
        this.audioCtx = audioCtx;
        const dest = audioCtx.createMediaStreamDestination();
        let hasAudioSource = false;

        for (const stream of options.audioStreams || []) {
          if (stream && stream.getAudioTracks().length > 0) {
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(dest);
            hasAudioSource = true;
          }
        }

        if (hasAudioSource) {
          dest.stream.getAudioTracks().forEach((t) => combinedTracks.push(t));
        }
      } catch {
        // Fallback: attach primary audio track directly
        options.primaryVideoStream
          ?.getAudioTracks()
          .forEach((t) => combinedTracks.push(t));
      }
    }

    this.compositeStream = new MediaStream(combinedTracks);
    const recorder = new MediaRecorder(this.compositeStream, {
      mimeType: selectedMime,
    });
    this.mediaRecorder = recorder;

    recorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        const nextChunkIndex = this.session.chunkCount;
        this.memoryChunks.push(event.data);
        this.session = appendRecordingChunk(this.session, event.data.size);
        this.onUpdate({ ...this.session });
        await saveRecordingChunkToVault(
          this.session.sessionId,
          nextChunkIndex,
          event.data
        );
      }
    };

    // Flush chunks every 1000ms for unlimited multi-hour resilience
    recorder.start(1000);
    this.onUpdate({ ...this.session });
    return this.session;
  }

  public pause(): UnlimitedRecordingSession {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
    }
    this.session = pauseRecordingSession(this.session);
    this.onUpdate({ ...this.session });
    return this.session;
  }

  public resume(): UnlimitedRecordingSession {
    if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
    }
    this.session = resumeRecordingSession(this.session);
    this.onUpdate({ ...this.session });
    return this.session;
  }

  public async stopAndSave(options: {
    title?: string;
    transcriptSummary?: string;
    autoDownload?: boolean;
  }): Promise<{ meta: StoredRecordingMeta; blob: Blob }> {
    if (this.syntheticAnimFrame !== null) {
      cancelAnimationFrame(this.syntheticAnimFrame);
      this.syntheticAnimFrame = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        if (!this.mediaRecorder) {
          resolve();
          return;
        }
        this.mediaRecorder.onstop = () => resolve();
        this.mediaRecorder.stop();
      });
    }

    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // ignore
      }
      this.audioCtx = null;
    }

    this.session = finalizeRecordingSession(this.session);
    this.onUpdate({ ...this.session });

    const blob = new Blob(this.memoryChunks, { type: this.session.mimeType });
    const durationSeconds = Math.max(
      1,
      Math.round(this.session.accumulatedMs / 1000)
    );

    const meta: StoredRecordingMeta = {
      sessionId: this.session.sessionId,
      roomCode: this.session.roomCode,
      title: options.title || `Reunião FREETING (${this.session.roomCode})`,
      startedAtIso: new Date(this.session.startedAtMs).toISOString(),
      durationSeconds,
      totalBytes: blob.size || this.session.totalBytes,
      chunkCount: this.session.chunkCount,
      mimeType: this.session.mimeType,
      transcriptSummary: options.transcriptSummary,
    };

    await saveRecordingMetaToVault(meta);

    if (options.autoDownload !== false && blob.size > 0) {
      const safeTime = new Date(this.session.startedAtMs)
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      triggerBlobDownload(
        blob,
        `freeting-${this.session.roomCode}-${safeTime}-unlimited.webm`
      );
    }

    return { meta, blob };
  }
}
