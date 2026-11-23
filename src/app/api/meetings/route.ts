import { NextResponse } from "next/server";
import { generateRoomCode } from "@/domain/roomCode";

export async function GET() {
  return NextResponse.json({
    platform: "FREETING",
    engine: "REA + Superpowers Reconstruction",
    limits: {
      maxMeetingDurationSeconds: null,
      maxRecordingDurationSeconds: null,
      unlimitedMeeting: true,
      unlimitedRecording: true,
    },
    sampleRoomCode: generateRoomCode(),
  });
}
