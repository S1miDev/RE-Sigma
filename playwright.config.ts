import { defineConfig } from '@playwright/test'

// App tests launch the unpacked build (dist/win-unpacked), so the shipped artefact is the one tested.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
})
