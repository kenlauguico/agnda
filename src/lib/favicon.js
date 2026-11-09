export const STATIC_FAVICON_PATH = '/favicon.svg';

const SVG_VIEW_BOX = '0 0 32 32';
const FACE_CENTER_X = 16;
const FACE_CENTER_Y = 18;
const FACE_RADIUS = 11;
const FACE_TOP_Y = FACE_CENTER_Y - FACE_RADIUS;
const TRACK_FILL = '#8f98a3';
const PROGRESS_FILL = '#ffffff';
const OUTLINE_FILL = '#46505a';

export function clampFaviconProgress(progress) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(1, Math.max(0, progress));
}

function buildTimerShell(innerMarkup) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SVG_VIEW_BOX}" role="img" aria-label="AGNDA timer">`,
    '<rect x="11" y="2.5" width="10" height="3.5" rx="1.75" fill="#46505a"/>',
    '<rect x="13" y="5.25" width="6" height="2.25" rx="1.125" fill="#8f98a3"/>',
    innerMarkup,
    '</svg>',
  ].join('');
}

function buildTimerFace(faceContent) {
  return [
    `<circle cx="${FACE_CENTER_X}" cy="${FACE_CENTER_Y}" r="${FACE_RADIUS}" fill="${TRACK_FILL}"/>`,
    faceContent,
    `<circle cx="${FACE_CENTER_X}" cy="${FACE_CENTER_Y}" r="${FACE_RADIUS}" fill="none" stroke="${OUTLINE_FILL}" stroke-width="2"/>`,
  ].join('');
}

function polarToCartesian(angleDegrees) {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;

  return {
    x: FACE_CENTER_X + FACE_RADIUS * Math.cos(radians),
    y: FACE_CENTER_Y + FACE_RADIUS * Math.sin(radians),
  };
}

function buildProgressSector(progress) {
  const clamped = clampFaviconProgress(progress);

  if (clamped <= 0) {
    return '';
  }

  if (clamped >= 1) {
    return `<circle cx="${FACE_CENTER_X}" cy="${FACE_CENTER_Y}" r="${FACE_RADIUS}" fill="${PROGRESS_FILL}"/>`;
  }

  const endPoint = polarToCartesian(clamped * 360);
  const largeArcFlag = clamped > 0.5 ? 1 : 0;

  return (
    `<path d="M ${FACE_CENTER_X} ${FACE_CENTER_Y} ` +
    `L ${FACE_CENTER_X} ${FACE_TOP_Y} ` +
    `A ${FACE_RADIUS} ${FACE_RADIUS} 0 ${largeArcFlag} 1 ${endPoint.x.toFixed(3)} ${endPoint.y.toFixed(3)} Z" ` +
    `fill="${PROGRESS_FILL}"/>`
  );
}

export function buildStaticTimerFaviconSvg() {
  return buildTimerShell(
    buildTimerFace(
      [
        '<path d="M16 18V11.5" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="2.2"/>',
        '<path d="M16 18l4.75 2.25" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="2.2"/>',
        '<circle cx="16" cy="18" r="1.8" fill="#ffffff"/>',
      ].join(''),
    ),
  );
}

export function buildActiveTimerFaviconSvg(progress) {
  return buildTimerShell(
    buildTimerFace(
      [
        buildProgressSector(progress),
        '<circle cx="16" cy="18" r="1.8" fill="#46505a"/>',
      ].join(''),
    ),
  );
}

export function svgToDataUrl(svg) {
  const normalizedSvg = svg
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return `data:image/svg+xml,${encodeURIComponent(normalizedSvg)}`;
}

export function ensureFaviconLink(documentRef = globalThis.document) {
  if (!documentRef?.head) {
    return null;
  }

  const links = [...documentRef.querySelectorAll('link[rel="icon"]')];
  const primaryLink = links[0] ?? documentRef.createElement('link');

  if (!links.length) {
    primaryLink.setAttribute('rel', 'icon');
    documentRef.head.append(primaryLink);
  }

  links.slice(1).forEach((link) => link.remove());
  return primaryLink;
}

export function setDocumentFavicon(href, documentRef = globalThis.document) {
  const faviconLink = ensureFaviconLink(documentRef);
  if (!faviconLink) {
    return null;
  }

  faviconLink.setAttribute('rel', 'icon');
  faviconLink.setAttribute('type', 'image/svg+xml');
  faviconLink.setAttribute('href', href);
  return faviconLink;
}

export function getTopicFaviconHref(topic, isRunning = false) {
  if (!isRunning) {
    return STATIC_FAVICON_PATH;
  }

  const seconds = Number(topic?.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return STATIC_FAVICON_PATH;
  }

  const elapsed = Number(topic?.elapsed) || 0;
  const progress = clampFaviconProgress(elapsed / seconds);
  return svgToDataUrl(buildActiveTimerFaviconSvg(progress));
}
