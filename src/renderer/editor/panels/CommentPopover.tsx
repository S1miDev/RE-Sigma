import { useState } from 'react'
import { Button, Input } from '../../ui'
import { toScreen } from '../canvas/viewport'
import { addComment, reply, removeComment, setResolved } from '../model/comments'
import { useEditor, useStore } from '../store'

/** The comment under the new-pin draft or the open pin, drawn beside it over the canvas. */
export function CommentPopover() {
  const store = useStore(), draft = useEditor((s) => s.draft), openId = useEditor((s) => s.openComment)
  const view = useEditor((s) => s.view), comment = useEditor((s) => s.doc.comments.find((c) => c.id === openId)), page = useEditor((s) => s.pageId)
  const [text, setText] = useState('')
  const at = draft && draft.page === page ? draft : comment && comment.page === page ? comment : null
  if (!at) return null
  const p = toScreen(view, at), close = () => (setText(''), store.set({ draft: null, openComment: null }))
  const submit = () => {
    if (!text.trim()) return
    if (draft) {
      const id = crypto.randomUUID()
      store.update((d) => addComment(d, draft, text, id))
      store.set({ draft: null, openComment: id })
    } else if (comment) store.update((d) => reply(d, comment.id, text))
    setText('')
  }
  return (
    <div role="dialog" aria-label={draft ? 'New comment' : 'Comment'} style={{ left: p.x + 16, top: p.y - 24 }}
      className="absolute z-20 flex w-64 flex-col gap-2 rounded-lg border border-line bg-panel p-2 shadow-xl" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
      {comment && (
        <ul aria-label="Thread" className="flex max-h-48 flex-col gap-1.5 overflow-auto">
          {[comment, ...(comment.replies ?? [])].map((m) => <li key={m.id} className="break-words"><span className="block text-[10px] text-dim">{new Date(m.at).toLocaleString()}</span>{m.text}</li>)}
        </ul>
      )}
      <Input autoFocus aria-label={draft ? 'Comment text' : 'Reply'} placeholder={draft ? 'Add a comment' : 'Reply'} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())} />
      <div className="flex justify-end gap-1">
        {comment && <Button onClick={() => store.update((d) => setResolved(d, comment.id, !comment.resolved))}>{comment.resolved ? 'Reopen' : 'Resolve'}</Button>}
        {comment && <Button onClick={() => (store.update((d) => removeComment(d, comment.id)), close())}>Delete</Button>}
        <Button onClick={close}>Close</Button>
        <Button variant="primary" disabled={!text.trim()} onClick={submit}>{draft ? 'Comment' : 'Reply'}</Button>
      </div>
    </div>
  )
}
