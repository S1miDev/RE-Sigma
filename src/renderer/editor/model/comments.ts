// Pinned comment threads: pure functions from a document to a new one. Run through store.update so each is one undo step.
import type { Comment, Document } from '../../../shared/document'

const now = () => new Date().toISOString()
const map = (doc: Document, id: string, f: (c: Comment) => Comment): Document => ({ ...doc, comments: doc.comments.map((c) => (c.id === id ? f(c) : c)) })

export const commentsOn = (doc: Document, page: string) => doc.comments.filter((c) => c.page === page)

export function addComment(doc: Document, at: { page: string; x: number; y: number }, text: string, id: string = crypto.randomUUID()): Document {
  const t = text.trim()
  return t && doc.pages.includes(at.page) ? { ...doc, comments: [...doc.comments, { id, ...at, text: t, at: now() }] } : doc
}
export function reply(doc: Document, id: string, text: string, rid: string = crypto.randomUUID()): Document {
  const t = text.trim()
  return t ? map(doc, id, (c) => ({ ...c, replies: [...(c.replies ?? []), { id: rid, text: t, at: now() }] })) : doc
}
export const setResolved = (doc: Document, id: string, resolved: boolean): Document => map(doc, id, ({ resolved: _, ...c }) => (resolved ? { ...c, resolved } : c))
export const removeComment = (doc: Document, id: string): Document => ({ ...doc, comments: doc.comments.filter((c) => c.id !== id) })
