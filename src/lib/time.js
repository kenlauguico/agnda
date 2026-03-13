export function clampIndex(index, length) {
  if (!length || length < 1) {
    return 0;
  }

  const numeric = Number(index);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const rounded = Math.floor(numeric);
  return Math.min(Math.max(0, rounded), length - 1);
}

export function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatShortDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}

export function formatMinuteSecond(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseLooseDuration(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const input = value.trim().toLowerCase();
  if (!input) {
    return null;
  }

  if (/^\d+(?::\d{1,2}){1,2}$/.test(input)) {
    const parts = input.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  if (/^\d+(\.\d+)?$/.test(input)) {
    return Math.round(Number(input) * 60);
  }

  const tokenPattern = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let totalSeconds = 0;
  let matchCount = 0;

  for (const match of input.matchAll(tokenPattern)) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) {
      return null;
    }

    if (unit.startsWith('h')) {
      totalSeconds += amount * 3600;
    } else if (unit.startsWith('m')) {
      totalSeconds += amount * 60;
    } else {
      totalSeconds += amount;
    }

    matchCount += 1;
  }

  if (matchCount > 0) {
    return Math.round(totalSeconds);
  }

  return null;
}

export function minutesFromSeconds(seconds) {
  return Math.max(1, Math.round((Number(seconds) || 0) / 60));
}
