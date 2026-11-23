import path from "path";
import fs from "fs";
import { ScheduledMeeting } from "@/domain/calendarSchedule";

export interface StoredAiNote {
  id: string;
  roomCode: string;
  title: string;
  summary: string;
  createdAtIso: string;
}

// Default seed meetings so the database is immediately rich and demonstrable
const DEFAULT_SEED_MEETINGS: ScheduledMeeting[] = [
  {
    id: "seed_mtg_1",
    title: "Sprint Review & Arquitetura FREETING (∞ Sem Limite)",
    roomCode: "amd-wraw-qkg",
    dateIso: "2026-11-23",
    startTime: "19:00",
    endTime: "∞ Sem Limite",
    hostName: "Erick Correa",
    status: "SCHEDULED",
    aiNotesEnabled: true,
    unlimitedRecordingEnabled: true,
    description: "Sala oficial reconstruída via REA + Superpowers sem limite de 60 minutos.",
  },
];

interface SqliteStatementLike {
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
  run: (...params: unknown[]) => unknown;
}

interface SqliteDatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementLike;
}

let dbInstance: SqliteDatabaseLike | null = null;
let memoryFallbackMeetings: ScheduledMeeting[] = [...DEFAULT_SEED_MEETINGS];
let memoryFallbackNotes: StoredAiNote[] = [];

function getSqliteDb(): SqliteDatabaseLike | null {
  if (dbInstance) return dbInstance;
  try {
    // Use Node.js 24 built-in node:sqlite module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require("node:sqlite") as {
      DatabaseSync: new (location: string) => SqliteDatabaseLike;
    };
    if (!sqlite || !sqlite.DatabaseSync) return null;

    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "freeting.sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        roomCode TEXT NOT NULL,
        dateIso TEXT NOT NULL,
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        hostName TEXT NOT NULL,
        status TEXT NOT NULL,
        aiNotesEnabled INTEGER NOT NULL DEFAULT 1,
        unlimitedRecordingEnabled INTEGER NOT NULL DEFAULT 1,
        description TEXT
      );
      CREATE TABLE IF NOT EXISTS ai_notes (
        id TEXT PRIMARY KEY,
        roomCode TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        createdAtIso TEXT NOT NULL
      );
    `);

    // Seed initial meeting if table is empty
    const countRow = db
      .prepare("SELECT COUNT(*) as total FROM meetings")
      .all()[0] as { total?: number } | undefined;
    if (!countRow || Number(countRow.total) === 0) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO meetings (
          id, title, roomCode, dateIso, startTime, endTime, hostName, status,
          aiNotesEnabled, unlimitedRecordingEnabled, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const seed of DEFAULT_SEED_MEETINGS) {
        insert.run(
          seed.id,
          seed.title,
          seed.roomCode,
          seed.dateIso,
          seed.startTime,
          seed.endTime,
          seed.hostName,
          seed.status,
          seed.aiNotesEnabled ? 1 : 0,
          seed.unlimitedRecordingEnabled ? 1 : 0,
          seed.description || ""
        );
      }
    }

    dbInstance = db;
    return dbInstance;
  } catch {
    return null;
  }
}

export function listMeetingsFromDb(): {
  meetings: ScheduledMeeting[];
  engine: "node:sqlite" | "memory-fallback";
} {
  const db = getSqliteDb();
  if (!db) {
    return { meetings: memoryFallbackMeetings, engine: "memory-fallback" };
  }
  const rows = db
    .prepare("SELECT * FROM meetings ORDER BY dateIso ASC, startTime ASC")
    .all();

  const meetings: ScheduledMeeting[] = rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    roomCode: String(r.roomCode),
    dateIso: String(r.dateIso),
    startTime: String(r.startTime),
    endTime: String(r.endTime),
    hostName: String(r.hostName),
    status: (r.status as ScheduledMeeting["status"]) || "SCHEDULED",
    aiNotesEnabled: Boolean(r.aiNotesEnabled),
    unlimitedRecordingEnabled: Boolean(r.unlimitedRecordingEnabled),
    description: r.description ? String(r.description) : undefined,
  }));

  return { meetings, engine: "node:sqlite" };
}

export function createMeetingInDb(meeting: ScheduledMeeting): ScheduledMeeting {
  const db = getSqliteDb();
  if (!db) {
    memoryFallbackMeetings = [
      ...memoryFallbackMeetings.filter((m) => m.id !== meeting.id),
      meeting,
    ];
    return meeting;
  }
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO meetings (
      id, title, roomCode, dateIso, startTime, endTime, hostName, status,
      aiNotesEnabled, unlimitedRecordingEnabled, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    meeting.id,
    meeting.title,
    meeting.roomCode,
    meeting.dateIso,
    meeting.startTime,
    meeting.endTime,
    meeting.hostName,
    meeting.status,
    meeting.aiNotesEnabled ? 1 : 0,
    meeting.unlimitedRecordingEnabled ? 1 : 0,
    meeting.description || ""
  );
  return meeting;
}

export function deleteMeetingFromDb(id: string): boolean {
  const db = getSqliteDb();
  if (!db) {
    memoryFallbackMeetings = memoryFallbackMeetings.filter((m) => m.id !== id);
    return true;
  }
  db.prepare("DELETE FROM meetings WHERE id = ?").run(id);
  return true;
}
