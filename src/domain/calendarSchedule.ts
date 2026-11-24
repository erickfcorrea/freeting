export type MeetingStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface ScheduledMeeting {
  id: string;
  title: string;
  roomCode: string;
  dateIso: string; // YYYY-MM-DD in local schedule
  startTime: string; // HH:mm
  endTime: string; // HH:mm or empty
  hostName: string;
  status: MeetingStatus;
  aiNotesEnabled: boolean;
  unlimitedRecordingEnabled: boolean;
  description?: string;
}

export interface WeekDayItem {
  dateIso: string;
  dayOfWeekShort: string;
  dayNumber: number;
  isSelected: boolean;
  isToday: boolean;
}

const PT_BR_DAYS_SHORT = ["DOM.", "SEG.", "TER.", "QUA.", "QUI.", "SEX.", "SÁB."];
const PT_BR_DAYS_HEADER = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const PT_BR_MONTHS_SHORT = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
];

export function toLocalDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDateIso(dateIso: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

/**
 * Formats Portuguese date header: "seg., 23 de nov."
 */
export function formatPortugueseDateHeader(date: Date): string {
  const weekday = PT_BR_DAYS_HEADER[date.getDay()];
  const dayNum = date.getDate();
  const month = PT_BR_MONTHS_SHORT[date.getMonth()];
  return `${weekday}, ${dayNum} de ${month}`;
}

/**
 * Builds the 7-day Sunday..Saturday calendar strip around selectedDate.
 */
export function buildWeekStrip(
  selectedDate: Date,
  todayDate: Date = new Date()
): WeekDayItem[] {
  const selectedIso = toLocalDateIso(selectedDate);
  const todayIso = toLocalDateIso(todayDate);

  const dayOfWeek = selectedDate.getDay(); // 0 (Sun) .. 6 (Sat)
  const sunday = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate() - dayOfWeek,
    12,
    0,
    0
  );

  const items: WeekDayItem[] = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(
      sunday.getFullYear(),
      sunday.getMonth(),
      sunday.getDate() + i,
      12,
      0,
      0
    );
    const iso = toLocalDateIso(current);
    items.push({
      dateIso: iso,
      dayOfWeekShort: PT_BR_DAYS_SHORT[i],
      dayNumber: current.getDate(),
      isSelected: iso === selectedIso,
      isToday: iso === todayIso,
    });
  }
  return items;
}

export function shiftDateByDays(date: Date, deltaDays: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + deltaDays,
    12,
    0,
    0
  );
}

export function filterMeetingsForDate(
  meetings: ScheduledMeeting[],
  dateIso: string
): ScheduledMeeting[] {
  return meetings
    .filter((m) => m.dateIso === dateIso && m.status !== "CANCELLED")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}
