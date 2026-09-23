import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

beforeEach(() => {
  // Most interaction tests start from an already-open assistant; production starts collapsed.
  window.sessionStorage.setItem('ekt-assistant-open', 'true')
})
