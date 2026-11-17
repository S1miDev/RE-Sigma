// Comment tool: a click drops a draft pin (or opens the pin under the pointer); the popover takes the text.
import { pinAt } from '../canvas/aids'
import type { EditorStore } from '../store'
import type { Gesture, Pointer } from './pointer'

export function commentGesture(store: EditorStore, p: Pointer): Gesture {
  return {
    move() {},
    up() {
      const s = store.get(), pin = pinAt(s, p.screen)
      if (pin) return void store.set({ openComment: pin.id, draft: null })
      store.set({ draft: { page: s.pageId, x: Math.round(p.world.x), y: Math.round(p.world.y) }, openComment: null })
    },
  }
}
