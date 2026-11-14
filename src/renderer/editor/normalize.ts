// The rules every edit is followed by, whatever it was: instances mirror their mains, text boxes follow their
// content, groups wrap their children, booleans combine them and auto-layout frames place theirs.
import type { Document } from '../../shared/document'
import { fitText } from './canvas/text'
import { syncBooleans } from './model/boolean'
import { syncInstances } from './model/components'
import { autoLayout, fitGroups, put } from './model/ops'
import { syncShapes } from './model/shapes'
import { resolveStyles } from './model/styles'

/** Re-measures text nodes changed since `prev`. */
function fitTexts(prev: Document, next: Document): Document {
  const refit = Object.values(next.nodes).filter((n) => n.type === 'TEXT' && prev.nodes[n.id] !== n).map(fitText).filter((n) => next.nodes[n.id] !== n)
  return refit.length ? put(next, refit) : next
}

/** Applies the rules to an edit from `prev` to `next`. `base` is the document before the current undo step (see syncInstances). */
export function normalize(prev: Document, next: Document, base: Document): Document {
  if (next === prev) return prev
  // instances sync first, while `next` still holds exactly what the user changed (their overrides)
  // styles first on ordinary nodes, so a style change reaches the mains; instance nodes take only the links they override, after the sync
  next = resolveStyles(prev, next, false)
  next = resolveStyles(next, syncInstances(prev, next, base), true)
  // auto layout can change a text box's width (fill), so text is measured again and laid out once more
  // star outlines follow their parameters, then a boolean's result is computed once the boxes have settled (fitGroups), before auto layout moves anything
  return autoLayout(fitTexts(prev, autoLayout(syncBooleans(prev, syncShapes(prev, fitGroups(fitTexts(prev, next)))))))
}
