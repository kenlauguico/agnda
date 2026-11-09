import { clampIndex } from './time';

export function advanceSessionBySeconds(previous, deltaSeconds) {
  if (!previous?.isRunning || deltaSeconds < 1 || !previous.topics?.length) {
    return previous;
  }

  const nextTopics = previous.topics.map((topic) => ({ ...topic }));
  let nextIndex = clampIndex(previous.currentIndex, nextTopics.length);
  let nextSelectedTopicId = previous.selectedTopicId;
  let nextSecondaryIndex = previous.secondaryIndex ?? -1;
  let nextSecondaryTopicId = previous.secondaryTopicId ?? null;
  let nextRunning = previous.isRunning;
  let remainingSeconds = Math.max(0, Math.floor(Number(deltaSeconds) || 0));

  if (!previous.autoAdvance) {
    const primary = nextTopics[nextIndex];
    if (primary) {
      nextTopics[nextIndex] = {
        ...primary,
        elapsed: primary.elapsed + remainingSeconds,
      };
    }
    
    if (nextSecondaryIndex >= 0) {
      const secondary = nextTopics[nextSecondaryIndex];
      if (secondary) {
        nextTopics[nextSecondaryIndex] = {
          ...secondary,
          elapsed: secondary.elapsed + remainingSeconds,
        };
      }
    }

    return {
      ...previous,
      topics: nextTopics,
    };
  }

  while (remainingSeconds > 0 && nextRunning) {
    const primary = nextIndex >= 0 && nextIndex < nextTopics.length ? nextTopics[nextIndex] : null;
    const secondary = nextSecondaryIndex >= 0 && nextSecondaryIndex < nextTopics.length ? nextTopics[nextSecondaryIndex] : null;

    const pSecondsLeft = primary ? Math.max(0, primary.seconds - primary.elapsed) : Infinity;
    const sSecondsLeft = secondary ? Math.max(0, secondary.seconds - secondary.elapsed) : Infinity;

    const primaryFinished = primary && pSecondsLeft === 0;
    const secondaryFinished = secondary && sSecondsLeft === 0;

    let primaryCanAdvance = false;
    let secondaryCanAdvance = false;

    if (primaryFinished) {
      let candidate = nextIndex + 1;
      while (candidate === nextSecondaryIndex) candidate++;
      if (candidate < nextTopics.length) {
        nextIndex = candidate;
        nextSelectedTopicId = nextTopics[candidate].id;
        primaryCanAdvance = true;
      }
    }

    if (secondaryFinished) {
      let candidate = nextSecondaryIndex + 1;
      while (candidate === nextIndex) candidate++;
      if (candidate < nextTopics.length) {
        nextSecondaryIndex = candidate;
        nextSecondaryTopicId = nextTopics[candidate].id;
        secondaryCanAdvance = true;
      }
    }

    if (primaryCanAdvance || secondaryCanAdvance) {
      continue;
    }

    if ((!primary || primaryFinished) && (!secondary || secondaryFinished)) {
      nextRunning = false;
      break;
    }

    const stepOptions = [remainingSeconds];
    if (primary && !primaryFinished) stepOptions.push(pSecondsLeft);
    if (secondary && !secondaryFinished) stepOptions.push(sSecondsLeft);

    const step = Math.min(...stepOptions);

    if (primary && !primaryFinished) {
      nextTopics[nextIndex] = {
        ...primary,
        elapsed: primary.elapsed + step,
      };
    }
    
    if (secondary && !secondaryFinished) {
      nextTopics[nextSecondaryIndex] = {
        ...secondary,
        elapsed: secondary.elapsed + step,
      };
    }

    remainingSeconds -= step;
  }

  return {
    ...previous,
    topics: nextTopics,
    currentIndex: nextIndex,
    selectedTopicId: nextSelectedTopicId,
    secondaryIndex: nextSecondaryIndex,
    secondaryTopicId: nextSecondaryTopicId,
    isRunning: nextRunning,
  };
}

export function reconcileRunningState(state, now = Date.now()) {
  if (!state?.isRunning) {
    return state;
  }

  const updatedAt = Number(state.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return state;
  }

  const deltaSeconds = Math.floor((Number(now) - updatedAt) / 1000);
  if (deltaSeconds < 1) {
    return state;
  }

  return {
    ...advanceSessionBySeconds(state, deltaSeconds),
    updatedAt: Number(now),
  };
}
