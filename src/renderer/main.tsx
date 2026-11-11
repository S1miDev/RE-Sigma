import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles.css'
import type { RefigApi } from '../shared/api'
import { App } from './App'

declare global {
  interface Window {
    refig: RefigApi
  }
}

// Canvas text can't trigger a font download on its own; load the bundled font up front.
void document.fonts.load('16px "Inter Variable"')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={window.refig} />
  </StrictMode>,
)
