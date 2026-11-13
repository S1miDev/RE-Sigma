// The rules every edit is followed by, whatever it was: instances mirror their mains, text boxes follow their
// content, groups wrap their children and auto-layout frames place theirs.
import type { Document } from '../../shared/document'
import { fitText } from './canvas/text'
import { syncInstances } from './model/components'
import { autoLayout, fitGroups, put } from './model/ops'

/** Re-measures text nodes changed since `prev`. */
function fitTexts(prev: Document, next: Document): Document {
  const refit = Object.values(next.nodes).filter((n) => n.type === 'TEXT' && prev.nodes[n.id] !== n).map(fitText).filter((n) => next.nodes[n.id] !== n)
  return refit.length ? put(next, refit) : next
}

/** Applies the rules to an edit from `prev` to `next`. `base` is the document before the current undo step (see syncInstances). */
export function normalize(prev: Document, next: Document, base: Document): Document {
  if (next === prev) return prev
  // instances sync first, while `next` still holds exactly what the user changed (their overrides)
  next = syncInstances(prev, next, base)
  // auto layout can change a text box's width (fill), so text is measured again and laid out once more
  return autoLayout(fitTexts(prev, autoLayout(fitGroups(fitTexts(prev, next)))))
}
