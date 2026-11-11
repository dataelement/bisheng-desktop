/**
 * The native view clips to its own bounds, and the measured box ignores
 * box-shadow. This padding has to contain the whole shadow. The margin matches
 * it so that padding stays inside the window instead of being cut off at the edge.
 */
export const updateCardShadowPad = 32
export const updateCardWindowMargin = 32
export const updateCardWidth = 384

export interface UpdateCardViewSize {
  width: number
  height: number
}

export function updateCardOuterWidth(): number {
  return updateCardWidth + updateCardShadowPad * 2
}

/** Used when the card is visible but its document has not been measured yet. */
const updateCardFallbackHeight = 320

export function updateCardMeasuredSize(card: UpdateCardViewSize): UpdateCardViewSize {
  return {
    width: card.width > 0 ? card.width : updateCardOuterWidth(),
    height: card.height > 0 ? card.height : updateCardFallbackHeight
  }
}

/** Place one desktop update card at the window's bottom-right. */
export function updateCardViewBounds(
  content: UpdateCardViewSize,
  card: UpdateCardViewSize
): { x: number; y: number; width: number; height: number } {
  const inset = updateCardWindowMargin - updateCardShadowPad
  const width = Math.max(0, Math.min(Math.round(card.width), Math.round(content.width) - inset))
  const height = Math.max(0, Math.min(Math.round(card.height), Math.round(content.height) - inset))
  return {
    x: Math.max(0, Math.round(content.width) - width - inset),
    y: Math.max(0, Math.round(content.height) - height - inset),
    width,
    height
  }
}
