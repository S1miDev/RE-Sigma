import { app } from 'electron'
import path from 'node:path'

/** REFIG_WORKSPACE (tests) wins; otherwise a visible folder in the user's Documents. */
export const workspaceDir = () => process.env.REFIG_WORKSPACE || path.join(app.getPath('documents'), 'Refig Projects')
