import { clampIndex } from './time';

export function advanceSessionBySeconds(previous, deltaSeconds) {
  if (!previous?.isRunning || deltaSeconds < 1 || !previous.topics?.length) {
    return previous;
  }

  const nextTopics = previous.topics.map((topic) => ({ ...topic }));
  let nextIndex = clampIndex(previous.currentIndex, nextTopics.length);
  let nextSelectedTopicId = previous.selectedTopicId;
  let nextRunning = previous.isRunning;
  let remainingSeconds = Math.max(0, Math.floor(Number(deltaSeconds) || 0));

  if (!previous.autoAdvance) {
    nextTopics[nextIndex] = {
      ...nextTopics[nextIndex],
      elapsed: nextTopics[nextIndex].elapsed + remainingSeconds,
    };

    return {
      ...previous,
      topics: nextTopics,
    };
  }

  while (remainingSeconds > 0 && nextRunning) {
    const currentTopic = nextTopics[nextIndex];
    if (!currentTopic) {
      nextRunning = false;
      break;
    }

    const secondsLeft = Math.max(0, currentTopic.seconds - currentTopic.elapsed);

    if (secondsLeft === 0) {
      if (nextIndex < nextTopics.length - 1) {
        nextIndex += 1;
        nextSelectedTopicId = nextTopics[nextIndex]?.id ?? nextSelectedTopicId;
        continue;
      }

      nextRunning = false;
      break;
    }

    if (remainingSeconds < secondsLeft) {
      nextTopics[nextIndex] = {
        ...currentTopic,
        elapsed: currentTopic.elapsed + remainingSeconds,
      };
      remainingSeconds = 0;
      break;
    }

    nextTopics[nextIndex] = {
      ...currentTopic,
      elapsed: currentTopic.elapsed + secondsLeft,
    };
    remainingSeconds -= secondsLeft;

    if (nextIndex < nextTopics.length - 1) {
      nextIndex += 1;
      nextSelectedTopicId = nextTopics[nextIndex]?.id ?? nextSelectedTopicId;
    } else {
      nextRunning = false;
    }
  }

  return {
    ...previous,
    topics: nextTopics,
    currentIndex: nextIndex,
    selectedTopicId: nextSelectedTopicId,
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
