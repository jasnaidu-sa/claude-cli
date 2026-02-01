import { describe, it, expect } from 'vitest';
import { formatDate } from './date-formatter';

describe('formatDate', () => {
  it('formats date correctly with double digit day and month', () => {
    const date = new Date(2024, 0, 15); // January 15, 2024
    expect(formatDate(date)).toBe('15/01/2024');
  });

  it('handles single digit days with leading zeros', () => {
    const date = new Date(2024, 5, 5); // June 5, 2024
    expect(formatDate(date)).toBe('05/06/2024');
  });

  it('handles single digit months with leading zeros', () => {
    const date = new Date(2024, 0, 25); // January 25, 2024
    expect(formatDate(date)).toBe('25/01/2024');
  });

  it('handles first day of year', () => {
    const date = new Date(2024, 0, 1); // January 1, 2024
    expect(formatDate(date)).toBe('01/01/2024');
  });

  it('handles last day of year', () => {
    const date = new Date(2024, 11, 31); // December 31, 2024
    expect(formatDate(date)).toBe('31/12/2024');
  });

  it('handles leap year edge case', () => {
    const date = new Date(2024, 1, 29); // February 29, 2024
    expect(formatDate(date)).toBe('29/02/2024');
  });

  it('formats different years correctly', () => {
    const date = new Date(2026, 0, 29); // January 29, 2026
    expect(formatDate(date)).toBe('29/01/2026');
  });
});
