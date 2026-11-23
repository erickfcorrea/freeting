import { describe, it, expect, vi } from "vitest";
import {
  generateRoomCode,
  isValidRoomCode,
  extractRoomCode,
  formatShareableLink,
} from "../roomCode";
import {
  MAX_MEETING_DURATION_MS,
  MAX_RECORDING_DURATION_MS,
  formatUnlimitedDuration,
  formatRecordingBytes,
  createRecordingSession,
  appendRecordingChunk,
  pauseRecordingSession,
  resumeRecordingSession,
  finalizeRecordingSession,
  getEffectiveRecordingDurationMs,
  releaseMediaStream,
} from "../unlimitedRecorder";
import {
  buildWeekStrip,
  formatPortugueseDateHeader,
  filterMeetingsForDate,
  ScheduledMeeting,
} from "../calendarSchedule";
import {
  listMeetingsFromDb,
  createMeetingInDb,
  deleteMeetingFromDb,
} from "../../services/sqliteDatabase";

describe("FREETING Core Domain — Reverse Engineered Google Meet + Unlimited Engine", () => {
  describe("Room Code Grammar (xxx-xxxx-xxx)", () => {
    it("generates valid 3-4-3 lowercase room codes", () => {
      const code = generateRoomCode();
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    });

    it("extracts room code from raw codes, 10-letter strings, and full Google Meet URLs", () => {
      expect(extractRoomCode("amd-wraw-qkg")).toBe("amd-wraw-qkg");
      expect(extractRoomCode("AMD-WRAW-QKG")).toBe("amd-wraw-qkg");
      expect(extractRoomCode("amdwrawqkg")).toBe("amd-wraw-qkg");
      expect(extractRoomCode("https://meet.google.com/amd-wraw-qkg?pli=1")).toBe(
        "amd-wraw-qkg"
      );
      expect(extractRoomCode("http://localhost:3000/room/xyz-abcd-efg")).toBe(
        "xyz-abcd-efg"
      );
      expect(extractRoomCode("")).toBeNull();
    });

    it("formats shareable link matching Meet card convention", () => {
      expect(formatShareableLink("amd-wraw-qkg")).toBe("freeting.app/amd-wraw-qkg");
      expect(formatShareableLink("amd-wraw-qkg", "http://localhost:3000")).toBe(
        "http://localhost:3000/room/amd-wraw-qkg"
      );
    });
  });

  describe("Unlimited Meeting & Recording Engine (No 60-minute limit)", () => {
    it("enforces infinite maximum duration for both meetings and recordings", () => {
      expect(MAX_MEETING_DURATION_MS).toBe(Number.POSITIVE_INFINITY);
      expect(MAX_RECORDING_DURATION_MS).toBe(Number.POSITIVE_INFINITY);
    });

    it("formats elapsed durations beyond 1 hour (60m+) and 10 hours without truncation", () => {
      expect(formatUnlimitedDuration(45)).toBe("00:00:45");
      expect(formatUnlimitedDuration(3599)).toBe("00:59:59");
      expect(formatUnlimitedDuration(3600)).toBe("01:00:00");
      expect(formatUnlimitedDuration(7325)).toBe("02:02:05");
      expect(formatUnlimitedDuration(36000)).toBe("10:00:00");
    });

    it("tracks continuous chunked recording across multi-hour pause/resume cycles", () => {
      const t0 = 1_000_000;
      let session = createRecordingSession("amd-wraw-qkg", t0);
      expect(session.state).toBe("RECORDING");

      session = appendRecordingChunk(session, 50 * 1024 * 1024);
      session = appendRecordingChunk(session, 75 * 1024 * 1024);
      expect(session.chunkCount).toBe(2);
      expect(formatRecordingBytes(session.totalBytes)).toBe("125.00 MB");

      const t90m = t0 + 90 * 60 * 1000;
      session = pauseRecordingSession(session, t90m);
      expect(session.state).toBe("PAUSED");
      expect(getEffectiveRecordingDurationMs(session, t90m + 600_000)).toBe(
        90 * 60 * 1000
      );

      const tResume = t90m + 600_000;
      session = resumeRecordingSession(session, tResume);
      const tEnd = tResume + 45 * 60 * 1000;
      session = finalizeRecordingSession(session, tEnd);

      expect(session.state).toBe("COMPLETED");
      expect(session.accumulatedMs).toBe(135 * 60 * 1000);
      expect(formatUnlimitedDuration(session.accumulatedMs / 1000)).toBe("02:15:00");
    });

    it("cleanly stops all media tracks on room teardown", () => {
      const stopA = vi.fn();
      const stopB = vi.fn();
      const count = releaseMediaStream({
        getTracks: () => [{ stop: stopA }, { stop: stopB }],
      });
      expect(count).toBe(2);
      expect(stopA).toHaveBeenCalledTimes(1);
      expect(stopB).toHaveBeenCalledTimes(1);
    });
  });

  describe("Google Meet Home 7-Day Calendar Strip & Scheduling", () => {
    it("formats Portuguese date header exactly like Meet ('seg., 23 de nov.')", () => {
      const nov23_2026 = new Date(2026, 10, 23, 12, 0, 0);
      expect(formatPortugueseDateHeader(nov23_2026)).toBe("seg., 23 de nov.");

      const strip = buildWeekStrip(nov23_2026, nov23_2026);
      expect(strip).toHaveLength(7);
      expect(strip[0].dayOfWeekShort).toBe("DOM.");
      expect(strip[0].dayNumber).toBe(22);
      expect(strip[1].dayOfWeekShort).toBe("SEG.");
      expect(strip[1].dayNumber).toBe(23);
      expect(strip[1].isSelected).toBe(true);
      expect(strip[6].dayOfWeekShort).toBe("SÁB.");
      expect(strip[6].dayNumber).toBe(28);
    });

    it("filters and sorts scheduled meetings for a selected date", () => {
      const meetings: ScheduledMeeting[] = [
        {
          id: "1",
          title: "Daily Sprint",
          roomCode: "amd-wraw-qkg",
          dateIso: "2026-11-23",
          startTime: "14:00",
          endTime: "∞ Sem Limite",
          hostName: "Erick",
          status: "SCHEDULED",
          aiNotesEnabled: true,
          unlimitedRecordingEnabled: true,
        },
        {
          id: "2",
          title: "Arquitetura FREETING",
          roomCode: "fre-etin-gapp",
          dateIso: "2026-11-23",
          startTime: "09:30",
          endTime: "∞ Sem Limite",
          hostName: "Erick",
          status: "SCHEDULED",
          aiNotesEnabled: true,
          unlimitedRecordingEnabled: true,
        },
      ];
      const filtered = filterMeetingsForDate(meetings, "2026-11-23");
      expect(filtered.map((m) => m.id)).toEqual(["2", "1"]);
    });
  });

  describe("Hybrid SQLite Database Layer (node:sqlite)", () => {
    it("persists, lists, and deletes scheduled meetings via SQLite engine", () => {
      const testId = `test_sqlite_${Date.now()}`;
      createMeetingInDb({
        id: testId,
        title: "Teste Banco SQLite FREETING",
        roomCode: "sql-test-dbx",
        dateIso: "2026-11-24",
        startTime: "15:00",
        endTime: "∞ Sem Limite",
        hostName: "Erick",
        status: "SCHEDULED",
        aiNotesEnabled: true,
        unlimitedRecordingEnabled: true,
      });

      const { meetings, engine } = listMeetingsFromDb();
      expect(["node:sqlite", "memory-fallback"]).toContain(engine);
      expect(meetings.some((m) => m.id === testId)).toBe(true);

      deleteMeetingFromDb(testId);
      const afterDelete = listMeetingsFromDb().meetings;
      expect(afterDelete.some((m) => m.id === testId)).toBe(false);
    });
  });
});
