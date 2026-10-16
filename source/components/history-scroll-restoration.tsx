'use client';

import { useEffect } from 'react';

const HISTORY_KEY = 'mudanzaPageScrollState';
const HISTORY_VERSION = 1;
const SAVE_DELAY_MS = 150;

type PageScrollSnapshot = {
  version: number;
  path: string;
  scrollY: number;
};

function readSnapshot(path: string): PageScrollSnapshot | null {
  const value = window.history.state?.[HISTORY_KEY] as Partial<PageScrollSnapshot> | undefined;
  if (value?.version !== HISTORY_VERSION || value.path !== path) return null;
  return {
    version: HISTORY_VERSION,
    path,
    scrollY: Math.max(0, Number(value.scrollY) || 0),
  };
}

export function HistoryScrollRestoration() {
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/carrito' && !path.startsWith('/producto/')) return;

    let savedScrollY = window.scrollY;
    let restoring = false;
    let linkNavigation = false;
    let saveTimer: number | null = null;

    const writeSnapshot = () => {
      const currentState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
      window.history.replaceState({
        ...currentState,
        [HISTORY_KEY]: {
          version: HISTORY_VERSION,
          path,
          scrollY: savedScrollY,
        },
      }, '', window.location.href);
    };

    const restore = (snapshot: PageScrollSnapshot) => {
      restoring = true;
      savedScrollY = snapshot.scrollY;
      let frames = 0;
      const restoreWhenReady = () => {
        frames += 1;
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (maxScroll < savedScrollY && frames < 120) {
          window.requestAnimationFrame(restoreWhenReady);
          return;
        }
        window.scrollTo({ top: Math.min(savedScrollY, maxScroll), left: 0, behavior: 'auto' });
        window.requestAnimationFrame(() => {
          savedScrollY = window.scrollY;
          restoring = false;
          writeSnapshot();
        });
      };
      window.requestAnimationFrame(restoreWhenReady);
    };

    const scheduleSave = () => {
      if (restoring) return;
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        savedScrollY = window.scrollY;
        writeSnapshot();
      }, SAVE_DELAY_MS);
    };
    const saveCurrent = () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = null;
      if (!linkNavigation) savedScrollY = window.scrollY;
      if (!restoring) writeSnapshot();
    };
    const captureLinkNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      linkNavigation = true;
      saveCurrent();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') saveCurrent();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const snapshot = readSnapshot(path);
      if (!snapshot) return;
      linkNavigation = false;
      restore(snapshot);
    };

    const initialSnapshot = readSnapshot(path);
    if (initialSnapshot) restore(initialSnapshot);
    else writeSnapshot();

    window.addEventListener('scroll', scheduleSave, { passive: true });
    window.addEventListener('pagehide', saveCurrent);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('click', captureLinkNavigation, true);

    return () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      window.removeEventListener('scroll', scheduleSave);
      window.removeEventListener('pagehide', saveCurrent);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('click', captureLinkNavigation, true);
    };
  }, []);

  return null;
}
