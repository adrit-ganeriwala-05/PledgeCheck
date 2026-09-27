import type { QueueCard } from "@/lib/clinic/queue";

// Most urgent first: cards whose patient has an open fill window, soonest closing first. The rest
// keep the server's order (needs review first, then oldest capture). A pending test has no window
// of its own yet; one opens on approval.
export function sortByUrgency(cards: QueueCard[]): QueueCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const aClose = a.card.window ? Date.parse(a.card.window.closesAt) : Number.POSITIVE_INFINITY;
      const bClose = b.card.window ? Date.parse(b.card.window.closesAt) : Number.POSITIVE_INFINITY;
      if (aClose !== bClose) return aClose - bClose;
      return a.index - b.index;
    })
    .map(({ card }) => card);
}
