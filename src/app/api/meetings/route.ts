import { NextRequest, NextResponse } from "next/server";
import { generateRoomCode } from "@/domain/roomCode";
import { ScheduledMeeting } from "@/domain/calendarSchedule";
import {
  listMeetingsFromDb,
  createMeetingInDb,
  deleteMeetingFromDb,
} from "@/services/sqliteDatabase";

export async function GET() {
  const { meetings, engine } = listMeetingsFromDb();
  return NextResponse.json({
    platform: "FREETING",
    databaseEngine: engine,
    limits: {
      maxMeetingDurationSeconds: null,
      maxRecordingDurationSeconds: null,
      unlimitedMeeting: true,
      unlimitedRecording: true,
    },
    meetings,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ScheduledMeeting>;
    const created: ScheduledMeeting = {
      id: body.id || `mtg_${Date.now()}`,
      title: (body.title || "Reunião Sem Limite FREETING").trim(),
      roomCode: body.roomCode || generateRoomCode(),
      dateIso: body.dateIso || "2026-11-23",
      startTime: body.startTime || "19:00",
      endTime: body.endTime || "∞ Sem Limite",
      hostName: body.hostName || "Erick Correa",
      status: body.status || "SCHEDULED",
      aiNotesEnabled: body.aiNotesEnabled ?? true,
      unlimitedRecordingEnabled: body.unlimitedRecordingEnabled ?? true,
      description:
        body.description || "Tempo de reunião e gravação 100% ilimitados.",
    };
    createMeetingInDb(created);
    const { meetings, engine } = listMeetingsFromDb();
    return NextResponse.json({ ok: true, databaseEngine: engine, meeting: created, meetings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Invalid payload" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing meeting id" }, { status: 400 });
  }
  deleteMeetingFromDb(id);
  const { meetings, engine } = listMeetingsFromDb();
  return NextResponse.json({ ok: true, databaseEngine: engine, meetings });
}
