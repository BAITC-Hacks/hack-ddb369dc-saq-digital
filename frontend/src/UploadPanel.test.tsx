import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadPanel, type UploadState } from './UploadPanel'
import type { ApiProduct } from './types'
import type { UploadCapabilities, UploadJob } from './uploadTypes'
import { ApiError, addToCart, ensureSession } from './lib/api'
import { createUpload, createUploadSession, deleteUpload, getUpload, getUploadCapabilities } from './lib/uploads'

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  ensureSession: vi.fn(),
  addToCart: vi.fn(),
}))
vi.mock('./lib/uploads', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/uploads')>(),
  getUploadCapabilities: vi.fn(),
  createUploadSession: vi.fn(),
  createUpload: vi.fn(),
  getUpload: vi.fn(),
  deleteUpload: vi.fn(),
}))

const requestId = 'c09e79ac-5cf2-4b49-b34b-6d4f004699dc'
const sessionId = 'original-upload-session'
const capabilities: UploadCapabilities = {
  enabled: true, maxFiles: 1, maxFileBytes: 24, maxItems: 50,
  resultTtlSeconds: 900, pollIntervalMs: 1_000,
  formats: [{ extensions: ['.pdf'], mimeType: 'application/pdf' }],
}
const product: ApiProduct = {
  sku: 'DEMO-MCB-003', name: 'Автомат Demo Power 3P C16', priceKzt: 7900,
  stock: 12, minimumOrderQuantity: 2,
}
const file = () => new File(['%PDF-1.7'], 'specification.pdf', { type: 'application/pdf' })
const job = (overrides: Partial<UploadJob> = {}): UploadJob => ({
  uploadId: '3a67a7f5-f45f-4fd2-897b-658fb973795b', requestId, status: 'completed',
  file: { name: 'specification.pdf', mimeType: 'application/pdf', sizeBytes: 8 },
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(),
  items: [{
    lineId: '1', description: 'Автомат из спецификации', article: product.sku,
    quantity: 4, unit: 'шт', sourceText: 'DEMO-MCB-003, 4 шт',
    specifications: { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: null },
    matchStatus: 'matched', matchCount: 1, warnings: [], requiresReview: true,
    candidates: [{ product, reason: 'Совпадает артикул из файла.', canFulfill: true, canAddToCart: true }],
  }],
  warnings: [], truncated: false, error: null,
  ...overrides,
})

function Harness({ initial = { phase: 'idle' }, choose = vi.fn(), disabled = false, visible = true }: {
  initial?: UploadState
  choose?: (product: ApiProduct, quantity: number, trigger: HTMLButtonElement) => void
  disabled?: boolean
  visible?: boolean
}) {
  const [state, setState] = useState<UploadState>(initial)
  if (!visible) return null
  return <UploadPanel state={state} onChange={setState} onChoose={choose} disabled={disabled} language="ru" />
}

async function selectFile(selected = file()) {
  const input = await screen.findByLabelText('Файл спецификации или фото')
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { files: [selected] } })
  return selected
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getUploadCapabilities).mockResolvedValue(capabilities)
  vi.mocked(createUploadSession).mockResolvedValue(sessionId)
  vi.mocked(createUpload).mockResolvedValue(job())
  vi.mocked(getUpload).mockResolvedValue(job())
  vi.mocked(deleteUpload).mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  expect(ensureSession).not.toHaveBeenCalled()
})

describe('file selection and server capabilities', () => {
  it('selects a file without sending it or creating a session, then uploads explicitly', async () => {
    render(<Harness />)
    const selected = await selectFile()
    expect(screen.getByText(/specification\.pdf/)).toBeInTheDocument()
    expect(createUpload).not.toHaveBeenCalled()
    expect(createUploadSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
    await waitFor(() => expect(createUpload).toHaveBeenCalledOnce())
    const [sentFile, sentRequestId, sentSessionId] = vi.mocked(createUpload).mock.calls[0]
    expect(sentFile).toBe(selected)
    expect(sentRequestId).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i)
    expect(sentSessionId).toBe(sessionId)
    expect(addToCart).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', new File([], 'empty.pdf', { type: 'application/pdf' }), /пуст/i],
    ['oversized', new File(['x'.repeat(25)], 'large.pdf', { type: 'application/pdf' }), /размер|превыш|лимит|слишком/i],
    ['unsupported', new File(['text'], 'notes.txt', { type: 'text/plain' }), /формат|тип|поддерж/i],
    ['mismatched MIME', new File(['text'], 'notes.pdf', { type: 'text/plain' }), /файл|формат|тип/i],
  ])('rejects an %s file locally using the returned limits', async (_kind, invalidFile, message) => {
    render(<Harness />)
    await selectFile(invalidFile)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    const send = screen.queryByRole('button', { name: 'Распознать файл' })
    if (send) expect(send).toBeDisabled()
    expect(createUpload).not.toHaveBeenCalled()
    expect(createUploadSession).not.toHaveBeenCalled()
  })

  it('uses advertised formats and disables transmission when the service is disabled', async () => {
    vi.mocked(getUploadCapabilities).mockResolvedValue({ ...capabilities, enabled: false })
    render(<Harness />)
    const input = await screen.findByLabelText('Файл спецификации или фото')
    await waitFor(() => expect(input).toBeDisabled())
    expect(input).toHaveAttribute('accept', '.pdf')
    const send = screen.queryByRole('button', { name: 'Распознать файл' })
    if (send) expect(send).toBeDisabled()
    expect(createUpload).not.toHaveBeenCalled()
    expect(createUploadSession).not.toHaveBeenCalled()
  })

  it('keeps upload actions disabled while another confirmation is unresolved', async () => {
    render(<Harness disabled initial={{ phase: 'selected', file: file(), requestId }} />)
    await waitFor(() => expect(getUploadCapabilities).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Распознать файл' })).toBeDisabled()
    expect(createUpload).not.toHaveBeenCalled()
  })
})

describe('retry, polling and deletion', () => {
  it('retries a failed transfer with the same file, request ID and pinned session', async () => {
    vi.mocked(createUpload).mockRejectedValueOnce(new ApiError('Соединение прервано.', 0, 'NETWORK_ERROR'))
    render(<Harness />)
    await selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить передачу' }))
    await waitFor(() => expect(createUpload).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createUpload).mock.calls[1].slice(0, 3)).toEqual(vi.mocked(createUpload).mock.calls[0].slice(0, 3))
    expect(createUploadSession).toHaveBeenCalledOnce()
    expect(await screen.findByText(product.name)).toBeInTheDocument()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('polls the existing job with its original session and stops on completion', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Harness initial={{ phase: 'waiting', sessionId, requestId, job: job({ status: 'queued', items: [] }) }} />)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(getUpload).toHaveBeenCalledOnce()
    expect(vi.mocked(getUpload).mock.calls[0].slice(0, 2)).toEqual([job().uploadId, sessionId])
    expect(screen.getByText(product.name)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getUpload).toHaveBeenCalledOnce()
    expect(createUploadSession).not.toHaveBeenCalled()
    expect(createUpload).not.toHaveBeenCalled()
  })

  it('shows the current processing stage without inventing recognition progress', async () => {
    vi.useFakeTimers()
    vi.mocked(getUpload).mockResolvedValueOnce(job({ status: 'processing', items: [] }))
    await act(async () => {
      render(<Harness initial={{ phase: 'waiting', sessionId, requestId, job: job({ status: 'queued', items: [] }) }} />)
    })
    expect(screen.getByRole('status')).toHaveTextContent(/очеред/i)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('status')).toHaveTextContent(/распозна/i)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByText(product.name)).toBeInTheDocument()
    expect(getUpload).toHaveBeenCalledTimes(2)
  })

  it('allows explicit status retry without retransmitting the file', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Harness initial={{
        phase: 'error', sessionId, requestId, job: job({ status: 'processing', items: [] }),
        error: 'NETWORK_ERROR', errorAction: 'poll',
      }} />)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить статус' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByText(product.name)).toBeInTheDocument()
    expect(getUpload).toHaveBeenCalledOnce()
    expect(vi.mocked(getUpload).mock.calls[0].slice(0, 2)).toEqual([job().uploadId, sessionId])
    expect(createUpload).not.toHaveBeenCalled()
    expect(createUploadSession).not.toHaveBeenCalled()
  })

  it('does not rotate the session or replay an upload after SESSION_REQUIRED', async () => {
    vi.mocked(createUpload).mockRejectedValue(new ApiError('Сессия истекла.', 401, 'SESSION_REQUIRED'))
    render(<Harness />)
    await selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/сесси|ист[её]к/i)
    expect(createUpload).toHaveBeenCalledOnce()
    expect(createUploadSession).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Новая попытка' })).toBeEnabled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('creates a new upload session and request ID only after an explicit new attempt', async () => {
    vi.mocked(createUploadSession).mockResolvedValueOnce(sessionId).mockResolvedValueOnce('replacement-upload-session')
    vi.mocked(createUpload).mockRejectedValueOnce(new ApiError('Сессия истекла.', 401, 'SESSION_REQUIRED'))
    render(<Harness />)
    const selected = await selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
    const reset = await screen.findByRole('button', { name: 'Новая попытка' })
    expect(createUploadSession).toHaveBeenCalledOnce()
    expect(createUpload).toHaveBeenCalledOnce()
    const previousRequestId = vi.mocked(createUpload).mock.calls[0][1]
    fireEvent.click(reset)
    expect(createUploadSession).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
    expect(await screen.findByText(product.name)).toBeInTheDocument()
    expect(createUploadSession).toHaveBeenCalledTimes(2)
    expect(createUpload).toHaveBeenCalledTimes(2)
    const [sentFile, sentRequestId, sentSessionId] = vi.mocked(createUpload).mock.calls[1]
    expect(sentFile).toBe(selected)
    expect(sentRequestId).not.toBe(previousRequestId)
    expect(sentSessionId).toBe('replacement-upload-session')
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('deletes the known job with the original session and removes the result', async () => {
    render(<Harness initial={{ phase: 'ready', sessionId, requestId, job: job() }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить и удалить файл' }))
    await waitFor(() => expect(deleteUpload).toHaveBeenCalledOnce())
    expect(vi.mocked(deleteUpload).mock.calls[0].slice(0, 2)).toEqual([job().uploadId, sessionId])
    await waitFor(() => expect(screen.queryByText(product.name)).not.toBeInTheDocument())
    expect(createUploadSession).not.toHaveBeenCalled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('keeps deletion locked if the result expires before DELETE finishes', async () => {
    vi.useFakeTimers()
    let finishDelete!: () => void
    vi.mocked(deleteUpload).mockImplementationOnce(() => new Promise<void>((resolve) => { finishDelete = resolve }))
    await act(async () => {
      render(<Harness initial={{ phase: 'ready', file: file(), sessionId, requestId, job: job({
        expiresAt: new Date(Date.now() + 1_500).toISOString(),
      }) }} />)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отменить и удалить файл' }))
    expect(deleteUpload).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent(/удал/i)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.getByRole('status')).toHaveTextContent(/удал/i)
    expect(screen.getByLabelText('Файл спецификации или фото')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отменить и удалить файл' })).toBeDisabled()
    const reset = screen.queryByRole('button', { name: 'Новая попытка' })
    if (reset) expect(reset).toBeDisabled()
    await act(async () => { finishDelete() })
    expect(screen.getByLabelText('Файл спецификации или фото')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Отменить и удалить файл' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Новая попытка' })).not.toBeInTheDocument()
    expect(screen.queryByText(/specification\.pdf/)).not.toBeInTheDocument()
    expect(createUpload).not.toHaveBeenCalled()
    expect(createUploadSession).not.toHaveBeenCalled()
  })

  it('offers a new attempt when DELETE fails after the result has expired', async () => {
    vi.useFakeTimers()
    let failDelete!: (reason: unknown) => void
    vi.mocked(deleteUpload).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failDelete = reject }))
    await act(async () => {
      render(<Harness initial={{ phase: 'ready', file: file(), sessionId, requestId, job: job({
        expiresAt: new Date(Date.now() + 1_500).toISOString(),
      }) }} />)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отменить и удалить файл' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.getByRole('button', { name: 'Отменить и удалить файл' })).toBeDisabled()
    await act(async () => { failDelete(new ApiError('Соединение прервано.', 0, 'NETWORK_ERROR')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('button', { name: 'Новая попытка' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/ист[её]к|устарел/i)
    expect(deleteUpload).toHaveBeenCalledOnce()
    expect(createUpload).not.toHaveBeenCalled()
    expect(createUploadSession).not.toHaveBeenCalled()
  })

  it('aborts a hidden panel transfer and preserves an explicit retry without automatic replay', async () => {
    vi.mocked(createUpload).mockImplementationOnce((_file, _requestId, _sessionId, _progress, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new ApiError('Передача прервана.', 0, 'REQUEST_ABORTED')), { once: true })
    }))
    const view = render(<Harness />)
    await selectFile()
    fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
    await waitFor(() => expect(createUpload).toHaveBeenCalledOnce())
    const firstCall = vi.mocked(createUpload).mock.calls[0]
    expect(firstCall[4]?.aborted).toBe(false)
    await act(async () => { view.rerender(<Harness visible={false} />) })
    expect(firstCall[4]?.aborted).toBe(true)
    view.rerender(<Harness />)
    const retry = await screen.findByRole('button', { name: 'Повторить передачу' })
    await waitFor(() => expect(retry).toBeEnabled())
    expect(createUpload).toHaveBeenCalledOnce()
    expect(createUploadSession).toHaveBeenCalledOnce()
    expect(screen.getByText(/specification\.pdf/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(retry)
    expect(await screen.findByText(product.name)).toBeInTheDocument()
    expect(createUpload).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createUpload).mock.calls[1].slice(0, 3)).toEqual(firstCall.slice(0, 3))
    expect(createUploadSession).toHaveBeenCalledOnce()
    expect(addToCart).not.toHaveBeenCalled()
  })
})

describe('manual review and safe results', () => {
  it('keeps an unknown quantity blank and requires both a valid quantity and review', async () => {
    const choose = vi.fn()
    const result = job()
    render(<Harness choose={choose} initial={{ phase: 'ready', sessionId, requestId, job: {
      ...result,
      items: [{ ...result.items[0], quantity: null, unit: null, candidates: [{ ...result.items[0].candidates[0], canFulfill: null, canAddToCart: false }] }],
    } }} />)
    const quantity = await screen.findByLabelText('Количество для корзины')
    expect(quantity).toHaveDisplayValue('')
    const candidate = screen.getByRole('button', { name: 'Проверить и выбрать' })
    expect(candidate).toBeDisabled()
    fireEvent.change(quantity, { target: { value: '2' } })
    expect(candidate).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Я проверил позицию, количество и единицу измерения' }))
    expect(candidate).toBeEnabled()
    fireEvent.click(candidate)
    expect(choose).toHaveBeenCalledOnce()
    expect(choose).toHaveBeenCalledWith(product, 2, candidate)
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('requires explicit review even for an exact match and forwards the chosen quantity', async () => {
    const choose = vi.fn()
    render(<Harness choose={choose} initial={{ phase: 'ready', sessionId, requestId, job: job() }} />)
    const quantity = await screen.findByLabelText('Количество для корзины')
    expect(quantity).toHaveDisplayValue('4')
    const candidate = screen.getByRole('button', { name: 'Проверить и выбрать' })
    expect(candidate).toBeDisabled()
    fireEvent.click(candidate)
    expect(choose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Я проверил позицию, количество и единицу измерения' }))
    fireEvent.click(candidate)
    expect(choose).toHaveBeenCalledOnce()
    expect(choose).toHaveBeenCalledWith(product, 4, candidate)
    expect(addToCart).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '1.5', '3', '14'])('blocks invalid, nonmultiple or excessive quantity %s', async (value) => {
    const choose = vi.fn()
    render(<Harness choose={choose} initial={{ phase: 'ready', sessionId, requestId, job: job() }} />)
    fireEvent.change(await screen.findByLabelText('Количество для корзины'), { target: { value } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Я проверил позицию, количество и единицу измерения' }))
    const candidate = screen.getByRole('button', { name: 'Проверить и выбрать' })
    expect(candidate).toBeDisabled()
    fireEvent.click(candidate)
    expect(choose).not.toHaveBeenCalled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('renders source text and warnings literally, including HTML-like content', async () => {
    const maliciousSource = '<script>window.uploadInjected = true</script>'
    const maliciousWarning = '<img src=x onerror=alert(1)>'
    const result = job()
    const view = render(<Harness initial={{ phase: 'ready', sessionId, requestId, job: {
      ...result, warnings: [maliciousWarning],
      items: [{ ...result.items[0], sourceText: maliciousSource, warnings: ['Проверьте единицу измерения.'] }],
    } }} />)
    expect(await screen.findByText(maliciousSource, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(maliciousWarning, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Проверьте единицу измерения.')).toBeInTheDocument()
    // These selectors verify that untrusted file contents never become executable elements.
    expect(view.container.querySelector('script, img[onerror]')).toBeNull()
  })

  it('shows empty, truncated results and server warnings without adding any items', async () => {
    const choose = vi.fn()
    render(<Harness choose={choose} initial={{ phase: 'ready', sessionId, requestId, job: job({
      items: [], truncated: true, warnings: ['Распознаны только первые 50 строк.'],
    }) }} />)
    expect(await screen.findByText(/не (?:найден|распознан)|нет распознан|не удалось распознать/i)).toBeInTheDocument()
    expect(screen.getByText('Распознаны только первые 50 строк.')).toBeInTheDocument()
    expect(screen.getByText(/результат.*(?:сокращ|обрез|неполн)|не все|часть строк|лимит строк/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Проверить и выбрать' })).not.toBeInTheDocument()
    expect(choose).not.toHaveBeenCalled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('removes selectable candidates when the server result expires', async () => {
    vi.useFakeTimers()
    const choose = vi.fn()
    await act(async () => {
      render(<Harness choose={choose} initial={{ phase: 'ready', sessionId, requestId, job: job({
        expiresAt: new Date(Date.now() + 1_500).toISOString(),
      }) }} />)
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Я проверил позицию, количество и единицу измерения' }))
    expect(screen.getByRole('button', { name: 'Проверить и выбрать' })).toBeEnabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.queryByRole('button', { name: 'Проверить и выбрать' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/ист[её]к|недоступ|удал[её]н|устарел/i)
    expect(screen.getByRole('button', { name: 'Новая попытка' })).toBeEnabled()
    expect(choose).not.toHaveBeenCalled()
    expect(addToCart).not.toHaveBeenCalled()
  })
})
