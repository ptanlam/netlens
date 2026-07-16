'use client';

import * as React from 'react';

/**
 * TEMPORARY diagnostic — remove once the iPad window-control overlap is fixed.
 * Renders a fixed bar reporting the live display-mode, the four safe-area insets
 * (resolved to px), Window-Controls-Overlay state, and the viewport width, so we can
 * see exactly what iPadOS 26 exposes to a windowed/split web app.
 */
export function SafeAreaDebug() {
  const [info, setInfo] = React.useState('measuring…');

  React.useEffect(() => {
    const read = () => {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;top:-9999px;left:0;' +
        'padding-top:env(safe-area-inset-top,0px);' +
        'padding-right:env(safe-area-inset-right,0px);' +
        'padding-bottom:env(safe-area-inset-bottom,0px);' +
        'padding-left:env(safe-area-inset-left,0px);';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const insets = `T${cs.paddingTop} R${cs.paddingRight} B${cs.paddingBottom} L${cs.paddingLeft}`;
      probe.remove();

      const modes = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay', 'browser']
        .filter((m) => window.matchMedia(`(display-mode: ${m})`).matches)
        .join(',') || 'none';

      const wco = (navigator as unknown as { windowControlsOverlay?: { visible?: boolean; getTitlebarAreaRect?: () => DOMRect } })
        .windowControlsOverlay;
      const rect = wco?.getTitlebarAreaRect?.();
      const wcoStr = wco
        ? `wco:${wco.visible}${rect ? ` x${Math.round(rect.x)} w${Math.round(rect.width)}` : ''}`
        : 'wco:n/a';

      setInfo(`mode:${modes} | inset ${insets} | ${wcoStr} | vw${window.innerWidth}`);
    };

    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: '#000',
        color: '#0f0',
        font: '11px/1.4 monospace',
        padding: '4px 6px',
        textAlign: 'center',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {info}
    </div>
  );
}
