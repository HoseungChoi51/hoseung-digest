function datePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = datePartsInTimeZone(date, timeZone);
  const utc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return utc - date.getTime();
}

export function todayInTimeZone(timeZone) {
  const parts = datePartsInTimeZone(new Date(), timeZone);
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join('-');
}

export function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    throw new Error(`Expected date in YYYY-MM-DD format, got: ${dateString}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function addDays({ year, month, day }, days) {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

function zonedLocalTimeToUtc(parts, timeZone) {
  const guess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0)
  );
  let offset = timeZoneOffsetMs(guess, timeZone);
  let utc = new Date(guess.getTime() - offset);

  offset = timeZoneOffsetMs(utc, timeZone);
  utc = new Date(guess.getTime() - offset);

  return utc;
}

export function dateRangeForLocalDay(dateString, timeZone) {
  const startParts = { ...parseDateString(dateString), hour: 0, minute: 0, second: 0 };
  const endDay = addDays(startParts, 1);
  const endParts = { ...endDay, hour: 0, minute: 0, second: 0 };

  return {
    start: zonedLocalTimeToUtc(startParts, timeZone),
    end: zonedLocalTimeToUtc(endParts, timeZone)
  };
}

export function formatDateTime(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
