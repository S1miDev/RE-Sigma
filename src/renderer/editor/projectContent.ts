import type { ProjectContent } from '../../shared/api'
import type { EditorStore } from './store'

/** Makes the images of another document (a saved version, a library) available to this store before its nodes are used. */
export async function adoptImages(store: EditorStore, { images }: ProjectContent) {
  for (const [hash, bytes] of Object.entries(images)) if (!store.imageBytes(hash)) await store.addImage(bytes)
}
