import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Paperclip } from '@phosphor-icons/react'
import { ApiError } from './lib/api'
import { createUpload, createUploadSession, deleteUpload, getUpload, getUploadCapabilities, validateUploadFile } from './lib/uploads'
import { quantityError } from './lib/quantity'
import { ProductEvidence } from './ProductEvidence'
import { translations, type Language } from './i18n'
import { uploadErrorText, uploadText } from './uploadText'
import type { ApiProduct } from './types'
import type { UploadCapabilities, UploadJob, UploadLine } from './uploadTypes'
import './uploadStyles.css'

export type UploadState = {
  phase: 'idle' | 'selected' | 'uploading' | 'waiting' | 'ready' | 'error' | 'deleting' | 'expired'
  file?: File; requestId?: string; sessionId?: string; job?: UploadJob
  progress?: number | null; error?: string; errorAction?: 'send' | 'poll' | 'delete'
}
type Choose = (product: ApiProduct, quantity: number, trigger: HTMLButtonElement) => void
type Props = { state: UploadState; onChange: Dispatch<SetStateAction<UploadState>>; onChoose: Choose; disabled: boolean; language: Language | null }

function failure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'REQUEST_FAILED'
  if (error.status === 413) return 'FILE_TOO_LARGE'
  if (error.status === 401) return 'SESSION_REQUIRED'
  return error.code ?? 'REQUEST_FAILED'
}
function resultState(job: UploadJob): Pick<UploadState, 'phase' | 'job' | 'error'> {
  if (Date.parse(job.expiresAt) <= Date.now()) return { job, phase: 'expired', error: 'UPLOAD_NOT_FOUND' }
  return { job, phase: job.status === 'completed' ? 'ready' : job.status === 'failed' ? 'error' : 'waiting', error: job.error?.code }
}

function LineReview({ line, language, disabled, onChoose }: { line: UploadLine; language: Language | null; disabled: boolean; onChoose: Choose }) {
  const t = uploadText[language ?? 'ru']
  const ui = translations[language ?? 'ru']
  const [quantity, setQuantity] = useState(line.quantity === null ? '' : String(line.quantity))
  const [reviewed, setReviewed] = useState(false)
  const id = useId()
  return <article className="upload-line">
    <h3>{t.line} {line.lineId}</h3>
    <p lang="ru">{line.description}</p>
    <p>{t.article}: <span>{line.article ?? t.unknown}</span></p>
    <p>{t.extracted}: {line.quantity ?? t.unknown} · {line.unit ?? t.unknown}</p>
    <p>{t.source}: <span lang="ru">{line.sourceText}</span></p>
    {line.warnings.map((warning, index) => <p className="evidence-warning" lang="ru" key={index}>{warning}</p>)}
    <p>{t.matches}: {line.matchCount}</p>
    {line.candidates.length === 0 ? <p>{t.noMatch}</p> : <>
      <label htmlFor={id}>{t.quantity}</label>
      <input id={id} type="number" inputMode="numeric" min="1" step="1" value={quantity} disabled={disabled} onChange={(event) => { setQuantity(event.target.value); setReviewed(false) }} />
      <p>{t.reviewNote}</p>
      <label className="upload-review"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={(event) => setReviewed(event.target.checked)} />{t.review}</label>
      {line.candidates.map(({ product, reason }) => {
        const issue = quantityError(quantity, product)
        return <section className="upload-candidate" key={product.sku}>
          <h4 lang="ru">{product.name}</h4><p>{product.sku}</p>
          <p>{product.priceKzt.toLocaleString(language === 'kk' ? 'kk-KZ' : 'ru-RU')} KZT · {ui.inStock}: {product.stock}</p>
          <p lang="ru">{reason}</p>
          <ProductEvidence product={product} alternative={false} t={ui} />
          {issue && <p className="evidence-warning">{ui[issue]}</p>}
          <button type="button" disabled={disabled || !reviewed || Boolean(issue)} onClick={(event) => { if (!disabled && reviewed && !issue) onChoose(product, Number(quantity), event.currentTarget) }}>{t.choose}</button>
        </section>
      })}
    </>}
  </article>
}

export function UploadPanel({ state, onChange, onChoose, disabled, language }: Props) {
  const t = uploadText[language ?? 'ru']
  const [capabilities, setCapabilities] = useState<UploadCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState(false)
  const [check, setCheck] = useState(0)
  const pending = useRef(false)
  const transfer = useRef<AbortController | null>(null)
  const fileId = useId()
  const statusRef = useRef<HTMLParagraphElement>(null)
  const busy = state.phase === 'uploading' || state.phase === 'deleting'

  useEffect(() => {
    const controller = new AbortController()
    setCapabilityError(false)
    setCapabilities(null)
    getUploadCapabilities(controller.signal).then(setCapabilities).catch(() => { if (!controller.signal.aborted) setCapabilityError(true) })
    return () => controller.abort()
  }, [check])
  useEffect(() => () => transfer.current?.abort(), [])

  useEffect(() => {
    if (state.phase !== 'waiting' || !state.job || !state.sessionId || !capabilities) return
    const controller = new AbortController()
    const { uploadId } = state.job
    const session = state.sessionId
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const job = await getUpload(uploadId, session, controller.signal)
        if (controller.signal.aborted) return
        onChange((previous) => ({ ...previous, ...resultState(job), errorAction: 'poll' }))
        if (job.status === 'queued' || job.status === 'processing') timer = setTimeout(poll, capabilities.pollIntervalMs)
      } catch (error) {
        if (!controller.signal.aborted) onChange((previous) => ({ ...previous, phase: 'error', error: failure(error), errorAction: 'poll' }))
      }
    }
    timer = setTimeout(poll, capabilities.pollIntervalMs)
    return () => { clearTimeout(timer); controller.abort() }
  }, [state.phase, state.job?.uploadId, state.sessionId, capabilities])

  useEffect(() => {
    if (!state.job || state.phase === 'expired') return
    const remaining = Date.parse(state.job.expiresAt) - Date.now()
    const timer = setTimeout(() => onChange((previous) => previous.phase === 'deleting' ? previous : { ...previous, phase: 'expired', error: 'UPLOAD_NOT_FOUND' }), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [state.job?.expiresAt, state.phase])

  const send = async () => {
    if (disabled || pending.current || !state.file || !state.requestId || !capabilities?.enabled) return
    const issue = validateUploadFile(state.file, capabilities)
    if (issue) { onChange((previous) => ({ ...previous, phase: 'error', error: issue })); return }
    pending.current = true
    const controller = new AbortController()
    transfer.current = controller
    onChange((previous) => ({ ...previous, phase: 'uploading', progress: null, error: undefined, errorAction: 'send' }))
    statusRef.current?.focus()
    try {
      const session = state.sessionId ?? await createUploadSession(controller.signal)
      onChange((previous) => ({ ...previous, sessionId: session }))
      const job = await createUpload(state.file, state.requestId, session, (progress) => onChange((previous) => ({ ...previous, progress })), controller.signal)
      onChange((previous) => ({ ...previous, ...resultState(job) }))
    } catch (error) {
      onChange((previous) => ({ ...previous, phase: 'error', error: failure(error), errorAction: 'send' }))
    } finally { pending.current = false }
  }

  const remove = async () => {
    if (disabled || pending.current || !state.job || !state.sessionId) return
    pending.current = true
    onChange((previous) => ({ ...previous, phase: 'deleting', error: undefined, errorAction: 'delete' }))
    statusRef.current?.focus()
    try {
      await deleteUpload(state.job.uploadId, state.sessionId)
      onChange({ phase: 'idle' })
    } catch (error) { onChange((previous) => ({ ...previous, phase: 'error', error: failure(error), errorAction: 'delete' })) }
    finally { pending.current = false }
  }
  const terminalError = state.phase === 'expired' || state.job?.status === 'failed' || ['SESSION_REQUIRED', 'UPLOAD_NOT_FOUND', 'FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'EMPTY_FILE', 'INVALID_FILE', 'INVALID_UPLOAD', 'UPLOAD_CONFLICT'].includes(state.error ?? '')
  const jobExpired = Boolean(state.job && Date.parse(state.job.expiresAt) <= Date.now())

  return <details className="upload-panel">
    <summary><Paperclip size={18} aria-hidden="true" /> {t.title}</summary>
    <p>{t.privacy}</p>
    {!capabilities && !capabilityError && <p role="status">{t.loading}</p>}
    {(capabilityError || capabilities?.enabled === false) && <><p role="status">{t.unavailable}</p><button type="button" onClick={() => setCheck((value) => value + 1)}>{t.check}</button></>}
    {capabilities && <p>{t.limits} {Math.floor(capabilities.maxFileBytes / 1024)} KiB. {capabilities.formats.flatMap((format) => format.extensions).join(', ')}. {t.retention} {capabilities.resultTtlSeconds / 60}</p>}
    <label htmlFor={fileId}>{t.file}</label>
    <input id={fileId} type="file" accept={capabilities?.formats.flatMap((format) => format.extensions).join(',')} disabled={disabled || !capabilities?.enabled || busy || Boolean(state.file)} onChange={(event) => {
      const files = event.target.files
      if (!files?.length || !capabilities) return
      const file = files[0]
      const issue = files.length > 1 ? 'INVALID_UPLOAD' : validateUploadFile(file, capabilities)
      onChange(issue ? { phase: 'error', error: issue } : { phase: 'selected', file, requestId: crypto.randomUUID() })
      event.target.value = ''
    }} />
    {state.file && <p>{state.file.name} · {Math.ceil(state.file.size / 1024)} KiB</p>}
    <p ref={statusRef} tabIndex={-1} role="status">{state.phase === 'selected' ? t.selected : state.phase === 'uploading' ? t.uploading : state.phase === 'deleting' ? t.deleting : state.phase === 'waiting' ? state.job?.status === 'queued' ? t.queued : t.processing : state.phase === 'ready' ? t.completed : ''}</p>
    {state.phase === 'uploading' && <progress aria-label={t.progress} max={100} value={state.progress ?? undefined} />}
    {state.error && <p className="evidence-warning" role="alert">{uploadErrorText(state.error, language)}</p>}
    {state.phase === 'error' && state.errorAction === 'send' && !terminalError && <p>{t.interrupted}</p>}
    <div className="upload-actions">
      {state.phase === 'selected' && <button type="button" disabled={disabled || !capabilities?.enabled} onClick={() => void send()}>{t.send}</button>}
      {state.phase === 'selected' && <button type="button" disabled={disabled} onClick={() => onChange({ phase: 'idle' })}>{t.removeSelected}</button>}
      {state.phase === 'error' && !terminalError && state.errorAction === 'send' && <button type="button" disabled={disabled || !capabilities?.enabled} onClick={() => void send()}>{t.retrySend}</button>}
      {state.phase === 'error' && !terminalError && state.errorAction === 'poll' && <button type="button" disabled={disabled} onClick={() => onChange((previous) => ({ ...previous, phase: 'waiting', error: undefined }))}>{t.retryPoll}</button>}
      {terminalError && !busy && <button type="button" disabled={disabled} onClick={() => onChange(state.file ? { phase: 'selected', file: state.file, requestId: crypto.randomUUID() } : { phase: 'idle' })}>{t.reset}</button>}
      {state.job && <button type="button" disabled={disabled || busy} onClick={() => void remove()}>{t.remove}</button>}
    </div>
    {state.phase === 'ready' && state.job && <>
      {state.job.truncated && <p className="evidence-warning">{t.truncated}</p>}
      {state.job.warnings.map((warning, index) => <p className="evidence-warning" lang="ru" key={index}>{warning}</p>)}
      {state.job.items.length === 0 && <p>{t.empty}</p>}
      {state.job.items.map((line) => <LineReview key={`${state.job!.uploadId}-${line.lineId}`} line={line} language={language} disabled={disabled || jobExpired} onChoose={onChoose} />)}
    </>}
  </details>
}
