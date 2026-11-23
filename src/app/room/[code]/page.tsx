import { MeetingRoomView } from "@/components/room/MeetingRoomView";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const resolved = await params;
  return <MeetingRoomView roomCode={resolved.code} />;
}
