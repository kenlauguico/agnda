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

export function minutesFromSeconds(seconds) {
  return Math.max(1, Math.round((Number(seconds) || 0) / 60));
}
