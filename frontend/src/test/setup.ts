import '@testing-library/jest-dom/vitest'
import { transferableAbortController } from 'node:util'
import { beforeEach } from 'vitest'

// Integration tests use Node's real fetch, which requires a Node AbortSignal.
Object.assign(globalThis, { AbortController: transferableAbortController().constructor })

beforeEach(() => {
  // Interaction tests explicitly opt into the open state; production starts collapsed.
  window.sessionStorage.setItem('ekt-assistant-open', 'true')
})
