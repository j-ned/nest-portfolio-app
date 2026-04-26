export interface TimeSlot {
  startMin: number;
  endMin: number;
}

export function parseTimeToMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

export function toSlot(startTime: string, duration: number): TimeSlot {
  const startMin = parseTimeToMinutes(startTime);
  return { startMin, endMin: startMin + duration };
}

/**
 * Two time slots overlap iff: a.startMin < b.endMin && b.startMin < a.endMin.
 * Adjacent slots (a.endMin === b.startMin) do NOT overlap.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}
