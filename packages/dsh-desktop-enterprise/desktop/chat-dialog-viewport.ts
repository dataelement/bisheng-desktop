interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
  windowWidth: number
  windowHeight: number
  background: string
}

/** The app keeps its chat-region geometry while body portals use the full native window. */
export function chatDialogViewportScript(bounds: ContentBounds | undefined): string {
  const css = bounds ? `
    html[data-dsh-chat-viewport] { --dsh-chat-viewport-width: ${bounds.width}px; --dsh-chat-viewport-height: ${bounds.height}px; }
    html[data-dsh-chat-viewport], html[data-dsh-chat-viewport] body { background: transparent !important; }
    html[data-dsh-chat-viewport] #root {
      position: fixed;
      left: clamp(0px, calc(100vw - ${bounds.width}px), ${bounds.x}px);
      top: clamp(0px, calc(100dvh - ${bounds.height}px), ${bounds.y}px);
      width: ${bounds.width}px; height: ${bounds.height}px; overflow: hidden; background: ${bounds.background};
    }
    /* A portal must not paint once in the content region before native expansion. */
    @media (max-width: ${bounds.windowWidth - 0.5}px), (max-height: ${bounds.windowHeight - 0.5}px) {
      html[data-dsh-chat-viewport][data-dsh-modal-open] body > :not(#root, script, style, link) {
        opacity: 0 !important;
        animation-play-state: paused !important;
      }
    }
  ` : ''
  return `(() => {
    const root = document.documentElement;
    const css = ${JSON.stringify(css)};
    let style = document.getElementById('dsh-window-dialog-viewport');
    if (css) {
      if (!style) { style = document.createElement('style'); style.id = 'dsh-window-dialog-viewport'; document.head.appendChild(style); }
      if (style.textContent !== css) style.textContent = css;
      root.dataset.dshChatViewport = 'ready';
    } else {
      delete root.dataset.dshChatViewport;
      style?.remove();
    }
  })()`
}
