import { describe, expect, it } from 'vitest';
import {
  STATIC_FAVICON_PATH,
  buildActiveTimerFaviconSvg,
  buildStaticTimerFaviconSvg,
  clampFaviconProgress,
  getTopicFaviconHref,
  setDocumentFavicon,
  svgToDataUrl,
} from './favicon';

describe('favicon helpers', () => {
  it('clamps favicon progress between zero and one', () => {
    expect(clampFaviconProgress(-1)).toBe(0);
    expect(clampFaviconProgress(0.4)).toBe(0.4);
    expect(clampFaviconProgress(3)).toBe(1);
    expect(clampFaviconProgress(Number.NaN)).toBe(0);
  });

  it('returns a static favicon when the timer is paused or invalid', () => {
    expect(getTopicFaviconHref({ seconds: 300, elapsed: 45 }, false)).toBe(STATIC_FAVICON_PATH);
    expect(getTopicFaviconHref({ seconds: 0, elapsed: 45 }, true)).toBe(STATIC_FAVICON_PATH);
    expect(getTopicFaviconHref(null, true)).toBe(STATIC_FAVICON_PATH);
  });

  it('encodes live timer progress favicons as svg data urls', () => {
    const href = getTopicFaviconHref({ seconds: 300, elapsed: 75 }, true);

    expect(href).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(href.slice('data:image/svg+xml,'.length))).toContain('<path d="M 16 18');
    expect(svgToDataUrl(buildStaticTimerFaviconSvg())).toMatch(/^data:image\/svg\+xml,/);
    expect(buildActiveTimerFaviconSvg(1)).toContain('fill="#ffffff"');
  });

  it('creates and keeps a single favicon link in the document head', () => {
    const documentRef = document.implementation.createHTMLDocument('Favicon test');
    documentRef.head.innerHTML = [
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="icon" href="/favicon-32x32.png">',
    ].join('');

    const link = setDocumentFavicon(STATIC_FAVICON_PATH, documentRef);
    const faviconLink = documentRef.head.querySelector('link[rel="icon"]');

    expect(link).not.toBeNull();
    expect(documentRef.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(faviconLink?.getAttribute('href')).toBe(STATIC_FAVICON_PATH);
    expect(faviconLink?.getAttribute('type')).toBe('image/svg+xml');
  });
});
