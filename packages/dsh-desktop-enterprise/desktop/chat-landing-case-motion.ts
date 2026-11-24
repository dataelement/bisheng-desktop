const PLAY_TIMEOUT_MS = 250
const CASE_ENTRY_ID = 'dsh-chat-case-entry-'

/** Install the first frame while Chat is still covered by Work. Hidden renderers may not schedule frames. */
export function prepareChatLandingCasesScript(url: string, revision: number, deadline: number): string {
  return `(() => {
    if (location.href !== ${JSON.stringify(url)} || Date.now() >= ${deadline} ||
        (window.__dshChatCaseEntryRevision ?? 0) >= ${revision}) return;
    window.__dshChatCaseEntryRevision = ${revision};
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cases = document.querySelector('.dsh-chat-surface .dsh-chat-landing .chat-welcome-examples');
    const rows = cases?.querySelectorAll('.chat-welcome-examples-list > li');
    const cards = rows?.length ? rows : cases?.querySelectorAll('.chat-welcome-example') ?? [];
    const entries = [];
    // A canceled or timed-out handoff must never leave a row paused at zero opacity.
    setTimeout(() => {
      for (const entry of entries) if (entry.playState === 'paused') entry.cancel();
    }, ${PLAY_TIMEOUT_MS});
    for (const [index, card] of Array.from(cards).entries()) {
      for (const running of card.getAnimations()) {
        if (running.id.startsWith('${CASE_ENTRY_ID}') || running.animationName === 'chat-welcome-example-in') running.cancel();
      }
      const entry = card.animate([
        { opacity: 0, translate: '-8px 0px' }, { opacity: 1, translate: '0px 0px' }
      ], { duration: 280, delay: index * 100, easing: 'cubic-bezier(.25,.55,.35,1)', fill: 'backwards' });
      entries.push(entry);
      entry.id = '${CASE_ENTRY_ID}${revision}';
      entry.pause();
      entry.currentTime = 0;
    }
  })()`
}

/** Start the prepared rows on the visible renderer's first frame, then let that frame commit. */
export function playChatLandingCasesScript(url: string, revision: number): string {
  return `(() => {
    if (location.href !== ${JSON.stringify(url)}) return;
    return new Promise(resolve => requestAnimationFrame(() => {
      if (location.href === ${JSON.stringify(url)}) {
        for (const entry of document.getAnimations()) {
          if (entry.id === '${CASE_ENTRY_ID}${revision}' && entry.playState === 'paused') entry.play();
        }
      }
      requestAnimationFrame(() => resolve());
    }));
  })()`
}
