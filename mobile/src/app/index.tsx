import { BoardPreview } from '../screens/BoardPreview'

// TEMPORARY — the item-1b board, kept as the rendered route until item 2 phase 2 lands
// src/screens/Offering.tsx. Offering replaces this and BoardPreview is deleted then; item 3
// replaces it again with the real home screen. See BUILD-PLAN.md §3 and docs/handoff-item-2.md.
export default function Index() {
  return <BoardPreview />
}
