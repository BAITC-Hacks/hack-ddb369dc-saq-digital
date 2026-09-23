import '@testing-library/jest-dom/vitest'
import { transferableAbortController } from 'node:util'

// Integration tests use Node's real fetch, which requires a Node AbortSignal.
Object.assign(globalThis, { AbortController: transferableAbortController().constructor })
