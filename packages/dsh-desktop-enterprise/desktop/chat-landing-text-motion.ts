const FADE_OUT_MS = 78
const RESTORE_START_MS = 210
const RESTORE_END_MS = 310
const FADE_IN_DELAY_MS = 45
const FADE_IN_MS = 135

/** The isolated Chat document animates its own writing region without exporting any text. */
export function chatLandingTextMotionScript(url: string, phase: 'out' | 'in', revision: number, deadline: number): string {
  return `(() => {
    if (location.href !== ${JSON.stringify(url)} || location.pathname !== '/workspace/c/new' || Date.now() > ${deadline}) return;
    const previous = window.__dshChatLandingTextMotion;
    if (previous && previous.revision >= ${revision}) return;
    previous?.animation?.cancel();
    const motion = { revision: ${revision} };
    window.__dshChatLandingTextMotion = motion;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const writing = document.querySelector('.dsh-chat-surface .dsh-chat-landing .dsh-chat-composer .dsh-composer-writing');
    if (!writing || typeof writing.animate !== 'function') return;
    const leaving = ${phase === 'out'};
    const animation = leaving ? writing.animate([
      { opacity: 1, offset: 0, easing: 'ease-in' },
      { opacity: 0, offset: ${FADE_OUT_MS / RESTORE_END_MS} },
      { opacity: 0, offset: ${RESTORE_START_MS / RESTORE_END_MS}, easing: 'ease-out' },
      { opacity: 1, offset: 1 }
    ], { duration: ${RESTORE_END_MS} }) : writing.animate([
      { opacity: 0 }, { opacity: 1 }
    ], { duration: ${FADE_IN_MS}, delay: ${FADE_IN_DELAY_MS}, fill: 'backwards', easing: 'ease-out' });
    motion.animation = animation;
    const release = () => { if (window.__dshChatLandingTextMotion === motion) delete motion.animation; };
    void animation.finished.then(release, release);
    // Wait for the first fade, but let the track restore opacity on its own if the switch is interrupted.
    if (leaving) return animation.ready.then(() => new Promise(resolve => setTimeout(resolve, ${FADE_OUT_MS})), release);
  })()`
}
