import { useEffect, useState } from 'react'
import type { OpenedProject, RefigApi } from '../shared/api'
import { Editor } from './editor/Editor'
import { Home } from './home/Home'
import { Button, EmptyState, Spinner } from './ui'
import { errorText } from './util'

/** Home ⇄ Editor. One project is open at a time. */
export function App({ api }: { api: RefigApi }) {
  const [openId, setOpenId] = useState<string | null>(null)
  return openId ? <EditorLoader key={openId} api={api} id={openId} onExit={() => setOpenId(null)} /> : <Home api={api} onOpen={setOpenId} />
}

function EditorLoader({ api, id, onExit }: { api: RefigApi; id: string; onExit(): void }) {
  const [state, setState] = useState<{ opened?: OpenedProject; error?: string }>({})
  useEffect(() => {
    let live = true
    api.openProject(id).then((opened) => live && setState({ opened }), (e) => live && setState({ error: errorText(e) }))
    return () => void (live = false)
  }, [api, id])

  if (state.opened) return <Editor opened={state.opened} api={api} onExit={onExit} />
  return (
    <div className="grid h-full place-items-center">
      {state.error ? (
        <EmptyState title="Couldn't open this project" text={state.error}>
          <Button variant="primary" onClick={onExit}>Back to projects</Button>
        </EmptyState>
      ) : (
        <Spinner label="Opening project" />
      )}
    </div>
  )
}
