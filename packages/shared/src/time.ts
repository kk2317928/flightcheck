export const MACAU_TIME_ZONE = 'Asia/Macau';

const MACAU_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/;

const macauDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: MACAU_TIME_ZONE,
  year: 'numeric',
});

export function getMacauDateKey(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError('instant must be a valid Date');
  }

  return macauDateFormatter.format(instant);
}

export function startOfMacauDateUtc(dateKey: string): Date {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match?.groups) {
    throw new TypeError('dateKey must use YYYY-MM-DD');
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    throw new TypeError('dateKey must be a valid calendar date');
  }

  return new Date(calendarCheck.getTime() - MACAU_UTC_OFFSET_MS);
}
