import { createTopicFromMinutes, normalizeTopics } from './topics';

const V2_PREFIX = '#v2/';
const V3_PREFIX = '#v3/';

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

export function normalizeAgendaId(value, fallback = 'today') {
  const slug = String(value || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

export function humanizeAgendaId(agendaId) {
  const normalized = normalizeAgendaId(agendaId, '');
  if (!normalized) {
    return 'Today';
  }

  return normalized
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function buildAgendaHash(agendaId) {
  return `#${normalizeAgendaId(agendaId)}`;
}

function deriveAgendaIdentity(title, topics) {
  const derivedTitle =
    typeof title === 'string' && title.trim()
      ? title.trim()
      : topics[0]?.name?.trim() || humanizeAgendaId('today');

  return {
    title: derivedTitle,
    agendaId: normalizeAgendaId(derivedTitle),
  };
}

function parseV3Hash(hash) {
  const encodedPayload = hash.slice(V3_PREFIX.length);
  if (!encodedPayload) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeURIComponent(encodedPayload));
    const topics = normalizeTopics(Array.isArray(payload) ? payload : payload?.topics);
    if (!topics.length) {
      return null;
    }

    const identity = deriveAgendaIdentity(payload?.title, topics);
    return {
      kind: 'share',
      topics,
      title: identity.title,
      agendaId: identity.agendaId,
    };
  } catch {
    return null;
  }
}

function parseV2Hash(hash) {
  const encodedPayload = hash.slice(V2_PREFIX.length);
  if (!encodedPayload) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeURIComponent(encodedPayload));
    if (!Array.isArray(payload)) {
      return null;
    }

    const candidateTopics = payload.map((topic, index) => ({
      name: topic?.name ?? `Topic ${index + 1}`,
      seconds:
        topic?.seconds ??
        (Number.isFinite(Number(topic?.minutes)) ? Number(topic.minutes) * 60 : undefined),
      elapsed: topic?.elapsed ?? 0,
      tag: topic?.tag,
      notes: topic?.notes,
    }));

    const topics = normalizeTopics(candidateTopics);
    if (!topics.length) {
      return null;
    }

    const identity = deriveAgendaIdentity('', topics);
    return {
      kind: 'share',
      topics,
      title: identity.title,
      agendaId: identity.agendaId,
    };
  } catch {
    return null;
  }
}

function parseLegacyHash(hash) {
  const segments = hash.split('/').map(decodeSegment).filter(Boolean);
  if (!segments.length) {
    return null;
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

  if (!topics.length) {
    return null;
  }

  const identity = deriveAgendaIdentity('', topics);
  return {
    kind: 'share',
    topics,
    title: identity.title,
    agendaId: identity.agendaId,
  };
}

export function parseAgendaHash(hash) {
  if (typeof hash !== 'string' || hash.length === 0 || hash === '#') {
    return {
      kind: 'empty',
      topics: [],
      title: '',
      agendaId: 'today',
    };
  }

  if (hash.startsWith(V3_PREFIX)) {
    return parseV3Hash(hash) ?? { kind: 'empty', topics: [], title: '', agendaId: 'today' };
  }

  if (hash.startsWith(V2_PREFIX)) {
    return parseV2Hash(hash) ?? { kind: 'empty', topics: [], title: '', agendaId: 'today' };
  }

  if (hash.includes('/')) {
    return parseLegacyHash(hash) ?? { kind: 'empty', topics: [], title: '', agendaId: 'today' };
  }

  const agendaId = normalizeAgendaId(hash);
  return {
    kind: 'slug',
    topics: [],
    title: humanizeAgendaId(agendaId),
    agendaId,
  };
}

export function parseTopicsFromHash(hash) {
  return parseAgendaHash(hash).topics;
}

export function encodeTopicsToHash(topics, title = '') {
  const normalizedTopics = normalizeTopics(topics);
  const payload = {
    title: typeof title === 'string' ? title.trim() : '',
    topics: normalizedTopics.map(({ name, seconds, tag }) => ({ name, seconds, tag })),
  };
  return `${V3_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}
