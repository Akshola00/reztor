import { BoardPreview } from '../screens/BoardPreview'

// Temporary: the board preview is deleted at the start of build item 2 and this route becomes
// the entry screen — name, create or join by code. See BUILD-PLAN.md §3.
export default function Index() {
  return <BoardPreview />
}
