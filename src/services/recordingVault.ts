import {
  UnlimitedRecordingSession,
  createRecordingSession,
  appendRecordingChunk,
  pauseRecordingSession,
  resumeRecordingSession,
  finalizeRecordingSession,
  getEffectiveRecordingDurationMs,
} from "@/domain/unlimitedRecorder";
import { sanitizeDownloadFilename } from "@/domain/securityGuard";

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

export function getRecordingFileExtension(mimeType?: string): "mp4" | "webm" {
  return mimeType && mimeType.toLowerCase().includes("mp4") ? "mp4" : "webm";
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const safeFilename = sanitizeDownloadFilename(filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFilename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/**
 * Creates a live 30fps virtual camera stream via HTML5 Canvas
 * whenever a user activates their camera on a device without a physical webcam.
 */
export function createVirtualCameraStream(participantName: string, roomCode: string): {
  stream: MediaStream;
  stopVirtualCamera: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  let animId: number | null = null;
  let frame = 0;

  const draw = () => {
    if (!ctx) return;
    frame++;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#0f2547");
    grad.addColorStop(0.5, "#1b3a6b");
    grad.addColorStop(1, "#0d1b2a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Animated pulse rings
    const pulse = Math.sin(frame * 0.06) * 14;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2 - 20, 108 + pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(16, 185, 129, 0.3)";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2 - 20, 84, 0, Math.PI * 2);
    ctx.fillStyle = "#059669";
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      (participantName || "E").charAt(0).toUpperCase(),
      canvas.width / 2,
      canvas.height / 2 + 2
    );

    ctx.font = "bold 26px sans-serif";
    ctx.fillText(participantName, canvas.width / 2, canvas.height / 2 + 125);

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#81c995";
    ctx.fillText(
      `Câmera Virtual HD • Sala ${roomCode} • ${new Date().toLocaleTimeString("pt-BR")}`,
      canvas.width / 2,
      canvas.height / 2 + 162
    );
    ctx.textAlign = "left";

    animId = requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(30);
  const stopVirtualCamera = () => {
    if (animId !== null) cancelAnimationFrame(animId);
    stream.getTracks().forEach((t) => t.stop());
  };

  return { stream, stopVirtualCamera };
}

/**
 * LiveUnlimitedMediaRecorder:
 * Records camera, screen share, or an automatic 30fps live stage canvas compositor
 * + mixed multi-participant Web Audio API tracks with 1-second chunked persistence
 * and ZERO duration limit.
 */
export class LiveUnlimitedMediaRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private session: UnlimitedRecordingSession;
  private memoryChunks: Blob[] = [];
  private pendingVaultWrites: Promise<void>[] = [];
  private syntheticCanvas: HTMLCanvasElement | null = null;
  private syntheticAnimFrame: number | null = null;
  private audioCtx: AudioContext | null = null;
  private audioDest: MediaStreamAudioDestinationNode | null = null;
  private attachedStreamIds = new Set<string>();
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

  public attachAudioStream(stream: MediaStream | null | undefined): void {
    if (!stream || !this.audioCtx || !this.audioDest) return;
    if (this.attachedStreamIds.has(stream.id)) return;
    if (!stream.getAudioTracks().some((t) => t.readyState === "live")) return;
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      source.connect(this.audioDest);
      this.attachedStreamIds.add(stream.id);
    } catch {
      // ignore duplicate or ended stream
    }
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
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
    ];
    const selectedMime =
      mimeCandidates.find(
        (m) =>
          typeof MediaRecorder !== "undefined" &&
          typeof MediaRecorder.isTypeSupported === "function" &&
          MediaRecorder.isTypeSupported(m)
      ) || "";

    this.session = createRecordingSession(
      options.roomCode,
      Date.now(),
      selectedMime || "video/webm"
    );
    this.memoryChunks = [];
    this.pendingVaultWrites = [];

    const combinedTracks: MediaStreamTrack[] = [];
    const realVideoTrack = options.primaryVideoStream
      ?.getVideoTracks()
      .find((t) => t.readyState === "live");

    if (realVideoTrack) {
      combinedTracks.push(realVideoTrack);
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      this.syntheticCanvas = canvas;
      const ctx = canvas.getContext("2d");

      const renderFrame = () => {
        if (!ctx || !this.syntheticCanvas) return;
        ctx.fillStyle = "#1b3a6b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "rgba(19, 19, 20, 0.88)";
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

        const names = options.participantNames.length
          ? options.participantNames
          : ["Você (Organizador)"];
        const step = canvas.width / (names.length + 1);
        names.forEach((name, idx) => {
          const cx = step * (idx + 1);
          const cy = canvas.height / 2;

          ctx.beginPath();
          ctx.arc(cx, cy, 68, 0, Math.PI * 2);
          ctx.fillStyle = idx % 2 === 0 ? "#059669" : "#b45309";
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 40px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(name.charAt(0).toUpperCase(), cx, cy + 14);

          ctx.font = "20px sans-serif";
          ctx.fillText(name, cx, cy + 110);
          ctx.textAlign = "left";
        });

        const caption = options.getActiveCaption?.();
        if (caption) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
          ctx.fillRect(120, canvas.height - 110, canvas.width - 240, 64);
          ctx.fillStyle = "#ffffff";
          ctx.font = "21px sans-serif";
          ctx.fillText(caption.slice(0, 88), 145, canvas.height - 70);
        }

        this.syntheticAnimFrame = requestAnimationFrame(renderFrame);
      };
      renderFrame();

      const canvasStream = canvas.captureStream(30);
      canvasStream.getVideoTracks().forEach((t) => combinedTracks.push(t));
    }

    if (typeof window !== "undefined") {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          if (audioCtx.state === "suspended") {
            await audioCtx.resume().catch(() => {});
          }
          this.audioCtx = audioCtx;
          const dest = audioCtx.createMediaStreamDestination();
          this.audioDest = dest;
          this.attachedStreamIds.clear();

          // Silent baseline oscillator keeps audio track alive even if everyone starts muted
          const osc = audioCtx.createOscillator();
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0;
          osc.connect(silentGain);
          silentGain.connect(dest);
          osc.start();

          for (const stream of options.audioStreams || []) {
            this.attachAudioStream(stream);
          }

          dest.stream.getAudioTracks().forEach((t) => combinedTracks.push(t));
        }
      } catch {
        options.primaryVideoStream
          ?.getAudioTracks()
          .forEach((t) => combinedTracks.push(t));
      }
    }

    this.compositeStream = new MediaStream(combinedTracks);
    const recorder = selectedMime
      ? new MediaRecorder(this.compositeStream, { mimeType: selectedMime })
      : new MediaRecorder(this.compositeStream);
    this.mediaRecorder = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        const nextChunkIndex = this.session.chunkCount;
        this.memoryChunks.push(event.data);
        this.session = appendRecordingChunk(this.session, event.data.size);
        this.onUpdate({ ...this.session });
        const writePromise = saveRecordingChunkToVault(
          this.session.sessionId,
          nextChunkIndex,
          event.data
        );
        this.pendingVaultWrites.push(writePromise);
      }
    };

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
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        if (!this.mediaRecorder) {
          resolve();
          return;
        }
        this.mediaRecorder.onstop = () => resolve();
        try {
          if (this.mediaRecorder.state === "recording") {
            this.mediaRecorder.requestData();
          }
        } catch {
          // ignore
        }
        this.mediaRecorder.stop();
      });
    }

    if (this.syntheticAnimFrame !== null) {
      cancelAnimationFrame(this.syntheticAnimFrame);
      this.syntheticAnimFrame = null;
    }

    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // ignore
      }
      this.audioCtx = null;
      this.audioDest = null;
      this.attachedStreamIds.clear();
    }

    await Promise.allSettled(this.pendingVaultWrites);

    this.session = finalizeRecordingSession(this.session);
    this.onUpdate({ ...this.session });

    const blob = new Blob(this.memoryChunks, {
      type: this.session.mimeType || "video/webm",
    });
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
      mimeType: this.session.mimeType || "video/webm",
      transcriptSummary: options.transcriptSummary,
    };

    await saveRecordingMetaToVault(meta);

    if (options.autoDownload !== false && blob.size > 0) {
      const safeTime = new Date(this.session.startedAtMs)
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      const ext = getRecordingFileExtension(this.session.mimeType);
      triggerBlobDownload(
        blob,
        `freeting-${this.session.roomCode}-${safeTime}-unlimited.${ext}`
      );
    }

    return { meta, blob };
  }
}
