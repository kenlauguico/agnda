import { createTopicFromMinutes, normalizeTopics } from './topics';

const V2_PREFIX = '#v2/';

function decodeSegment(segment) {
  const trimmed = String(segment || '').replace(/^#/, '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function parseV2Hash(hash) {
  const encodedPayload = hash.slice(V2_PREFIX.length);
  if (!encodedPayload) {
    return [];
  }

  try {
    const payload = JSON.parse(decodeURIComponent(encodedPayload));
    if (!Array.isArray(payload)) {
      return [];
    }

    const candidateTopics = payload.map((topic, index) => ({
      name: topic?.name ?? `Topic ${index + 1}`,
      seconds:
        topic?.seconds ??
        (Number.isFinite(Number(topic?.minutes)) ? Number(topic.minutes) * 60 : undefined),
      elapsed: topic?.elapsed ?? 0,
    }));

    return normalizeTopics(candidateTopics);
  } catch {
    return [];
  }
}

function parseLegacyHash(hash) {
  const segments = hash.split('/').map(decodeSegment).filter(Boolean);
  if (!segments.length) {
    return [];
  }

  let lockedMinutes = null;
  const topics = [];

  segments.forEach((segment, index) => {
    if (index === 0 && /^\d+(\.\d+)?$/.test(segment) && Number(segment) >= 1) {
      lockedMinutes = Math.max(1, Math.round(Number(segment)));
      return;
    }

    const minutes = lockedMinutes ?? (index % 2 === 0 ? 10 : 15);
    topics.push(createTopicFromMinutes(segment, minutes));
  });

  return topics;
}

export function parseTopicsFromHash(hash) {
  if (typeof hash !== 'string' || hash.length === 0 || hash === '#') {
    return [];
  }

  if (hash.startsWith(V2_PREFIX)) {
    return parseV2Hash(hash);
  }

  return parseLegacyHash(hash);
}

export function encodeTopicsToHash(topics) {
  const normalizedTopics = normalizeTopics(topics);
  const payload = normalizedTopics.map(({ name, seconds }) => ({ name, seconds }));
  return `${V2_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}
