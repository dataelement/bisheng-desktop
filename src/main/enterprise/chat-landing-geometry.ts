import type { EnterpriseChatLandingGeometry, EnterpriseChatPresentation } from '../../shared/enterprise-chat-view'
import { CHAT_MODEL_TRIGGER } from './chat-layout'

type Rect = EnterpriseChatPresentation['bounds']
type LandingElements = Omit<EnterpriseChatLandingGeometry, 'seat'>

/** Read the painted landing elements only after Chromium has applied the native seat resize. */
export function chatLandingGeometryScript(url: string, width: number, height: number): string {
  return `(() => {
    if (location.href !== ${JSON.stringify(url)} || location.pathname !== '/workspace/c/new') return;
    if (Math.abs(innerWidth - ${width}) > 1 || Math.abs(innerHeight - ${height}) > 1) return null;
    const landing = document.querySelector('.dsh-chat-surface .dsh-chat-landing');
    const title = landing?.querySelector('.dsh-chat-headline');
    const composer = landing?.querySelector('.dsh-chat-composer');
    if (!landing || !title || !composer) return;
    const clip = landing.getBoundingClientRect();
    const read = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      if (x < clip.left - 1 || y < clip.top - 1 || right > clip.right + 1 || bottom > clip.bottom + 1) return;
      return { x, y, width, height };
    };
    const trigger = composer.querySelector(${JSON.stringify(CHAT_MODEL_TRIGGER)});
    const modelBounds = trigger && read(trigger);
    // Read the selected display caption only when closed. Never read the searchable input's value.
    const label = trigger?.getAttribute('data-state') === 'closed'
      ? trigger.querySelector('[data-label][aria-hidden="true"]')?.getAttribute('data-label') ?? trigger.firstElementChild?.textContent
      : undefined;
    const send = composer.querySelector('button.dsh-composer-send[data-testid="send-button"]');
    const sendBounds = send && read(send);
    return {
      title: read(title), composer: read(composer),
      model: label && modelBounds ? { label, width: modelBounds.width } : undefined,
      sendOpacity: sendBounds?.width > 0 ? Number(getComputedStyle(send).opacity) : undefined
    };
  })()`
}

function parseRect(value: unknown, viewportWidth: number, viewportHeight: number): Rect | undefined {
  if (!value || typeof value !== 'object') return
  const { x, y, width, height } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
      ![x, y, width, height].every(Number.isFinite) || x < -1 || y < -1 || width <= 0 || height <= 0 ||
      x + width > viewportWidth + 1 || y + height > viewportHeight + 1) return
  return { x, y, width, height }
}

function parseModel(value: unknown, composerWidth: number): LandingElements['model'] {
  if (!value || typeof value !== 'object') return
  const { label, width } = value as Record<string, unknown>
  if (typeof label !== 'string' || label.length > 160 || typeof width !== 'number' ||
      !Number.isFinite(width) || width <= 0 || width > composerWidth + 1) return
  const normalized = label.replace(/\s+/gu, ' ').trim()
  if (normalized && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) {
    return { label: normalized, width }
  }
}

/** A remote document supplies advisory geometry and a plain-text caption for the morph. */
export function parseChatLandingGeometry(value: unknown, width: number, height: number): LandingElements | undefined {
  if (!value || typeof value !== 'object') return
  const input = value as Record<string, unknown>
  const title = parseRect(input.title, width, height)
  const composer = parseRect(input.composer, width, height)
  if (!title || !composer) return
  const model = parseModel(input.model, composer.width)
  const opacity = input.sendOpacity
  return {
    title, composer,
    ...(model ? { model } : {}),
    ...(typeof opacity === 'number' && opacity >= 0 && opacity <= 1 ? { sendOpacity: opacity } : {})
  }
}
