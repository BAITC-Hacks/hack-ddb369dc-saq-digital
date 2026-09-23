import { ApiError } from '../lib/api'
import type { UiText } from '../i18n'

export type UiError = { key: 'shortQuery' | 'requestFailed' | 'requestTimeout' | 'serverUnavailable'; detail?: string }

export function uiError(error: unknown): UiError {
  if (error instanceof ApiError) {
    if (error.code === 'REQUEST_TIMEOUT') return { key: 'requestTimeout' }
    if (error.code === 'NETWORK_ERROR') return { key: 'serverUnavailable' }
    return { key: 'requestFailed', detail: error.message }
  }
  return { key: 'requestFailed' }
}

export function ErrorText({ error, t }: { error: UiError; t: UiText }) {
  // The current API supplies Russian prose; interface errors use translation keys.
  return <>{t[error.key]}{error.detail && <> <span lang="ru">{error.detail}</span></>}</>
}
