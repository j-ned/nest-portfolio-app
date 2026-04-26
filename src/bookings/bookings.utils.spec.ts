import { parseTimeToMinutes, slotsOverlap, toSlot } from './bookings.utils';

describe('parseTimeToMinutes', () => {
  it('parse "00:00" en 0', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
  });

  it('parse "14:30" en 870', () => {
    expect(parseTimeToMinutes('14:30')).toBe(870);
  });

  it('parse "23:59" en 1439', () => {
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });
});

describe('slotsOverlap', () => {
  it('détecte un chevauchement partiel', () => {
    // a = [10:00, 11:00], b = [10:30, 11:30] → chevauchement
    const a = toSlot('10:00', 60);
    const b = toSlot('10:30', 60);
    expect(slotsOverlap(a, b)).toBe(true);
  });

  it('considère deux slots adjacents comme NON chevauchants', () => {
    // a = [10:00, 11:00], b = [11:00, 12:00] → adjacent, pas overlap
    const a = toSlot('10:00', 60);
    const b = toSlot('11:00', 60);
    expect(slotsOverlap(a, b)).toBe(false);
  });

  it('considère deux slots disjoints comme NON chevauchants', () => {
    // a = [09:00, 10:00], b = [14:00, 15:00] → totalement séparés
    const a = toSlot('09:00', 60);
    const b = toSlot('14:00', 60);
    expect(slotsOverlap(a, b)).toBe(false);
  });
});
