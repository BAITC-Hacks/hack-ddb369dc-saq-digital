import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { attachmentSchema, matchAttachment, uploadDefaults, uploadFormats } from './attachments.js';

export class Uploads {
  constructor(catalog, processor, options = {}) {
    this.catalog = catalog;
    this.processor = processor;
    this.options = { ...uploadDefaults, ...options };
    for (const [key, value] of Object.entries(this.options)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid uploads configuration: ${key}`);
    }
    this.jobs = new Map();
    this.requests = new Map();
    this.active = 0;
  }

  capabilities() {
    return {
      enabled: typeof this.processor?.extractAttachment === 'function',
      maxFiles: 1,
      maxFileBytes: this.options.maxFileBytes,
      maxItems: this.options.maxItems,
      resultTtlSeconds: this.options.resultTtlMs / 1000,
      pollIntervalMs: 1000,
      formats: uploadFormats,
    };
  }

  submit(sessionId, { requestId, file }) {
    const key = JSON.stringify([sessionId, requestId]);
    const fingerprint = createHash('sha256').update(JSON.stringify([file.name, file.mimeType])).update(file.bytes).digest('hex');
    const previous = this.jobs.get(this.requests.get(key));
    if (previous && previous.expiresAt > Date.now()) {
      if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'UPLOAD_CONFLICT', 'Этот requestId уже использован для другого файла.');
      return this.snapshot(previous);
    }
    for (const job of this.jobs.values()) if (job.expiresAt <= Date.now()) this.remove(job.sessionId, job.uploadId);
    if (this.jobs.size >= this.options.maxJobs || [...this.jobs.values()].filter((job) => job.sessionId === sessionId).length >= this.options.maxJobsPerSession) {
      throw new ApiError(429, 'UPLOAD_LIMIT', 'Достигнут лимит заданий. Удалите старые результаты или повторите позже.');
    }
    const now = Date.now();
    const job = {
      uploadId: randomUUID(), requestId, sessionId, key, fingerprint,
      status: 'queued', file, createdAt: now, expiresAt: now + this.options.resultTtlMs,
      items: [], warnings: [], truncated: false, error: null,
      controller: new AbortController(),
    };
    job.expiryTimer = setTimeout(() => this.remove(sessionId, job.uploadId), this.options.resultTtlMs);
    job.expiryTimer.unref();
    this.jobs.set(job.uploadId, job);
    this.requests.set(key, job.uploadId);
    // Return the queued snapshot before starting work, including with synchronous processors.
    setImmediate(() => this.drain());
    return this.snapshot(job);
  }

  snapshot(job) {
    return {
      uploadId: job.uploadId, requestId: job.requestId, status: job.status,
      file: { name: job.file.name, mimeType: job.file.mimeType, sizeBytes: job.file.sizeBytes },
      createdAt: new Date(job.createdAt).toISOString(), expiresAt: new Date(job.expiresAt).toISOString(),
      items: job.items, warnings: job.warnings, truncated: job.truncated, error: job.error,
    };
  }

  get(sessionId, uploadId) {
    const job = this.jobs.get(uploadId);
    if (job && job.expiresAt <= Date.now()) this.remove(job.sessionId, uploadId);
    if (!job || job.sessionId !== sessionId || job.expiresAt <= Date.now()) {
      throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'Задание не найдено или срок хранения истёк.');
    }
    return this.snapshot(job);
  }

  remove(sessionId, uploadId) {
    const job = this.jobs.get(uploadId);
    if (!job || job.sessionId !== sessionId) return;
    this.jobs.delete(uploadId);
    this.requests.delete(job.key);
    clearTimeout(job.expiryTimer);
    job.controller.abort();
    job.file.bytes = undefined;
    job.items = [];
    job.warnings = [];
  }

  drain() {
    for (const job of this.jobs.values()) {
      if (this.active >= this.options.maxConcurrent) break;
      if (job.status !== 'queued') continue;
      this.active += 1;
      job.status = 'processing';
      void this.process(job);
    }
  }

  async process(job) {
    const signal = job.controller.signal;
    let rejectAbort;
    const interrupted = new Promise((_resolve, reject) => { rejectAbort = () => reject(signal.reason); });
    signal.addEventListener('abort', rejectAbort, { once: true });
    const timeout = setTimeout(() => job.controller.abort(Object.assign(new Error('Upload timed out'), { code: 'UPLOAD_TIMEOUT' })), this.options.timeoutMs);
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return this.processor.extractAttachment(job.file, { ...this.options, signal });
        }),
        interrupted,
      ]);
      if (!this.jobs.has(job.uploadId)) return;
      const extraction = attachmentSchema(this.options.maxItems).parse(result);
      job.items = matchAttachment(extraction, this.catalog);
      job.warnings = extraction.warnings;
      job.truncated = extraction.truncated;
      job.status = 'completed';
    } catch (error) {
      if (!this.jobs.has(job.uploadId)) return;
      const code = error?.code === 'AI_CALL_LIMIT' ? 'AI_CALL_LIMIT'
        : error?.code === 'UPLOAD_TIMEOUT' || error?.name === 'TimeoutError' ? 'UPLOAD_TIMEOUT' : 'UPLOAD_PROCESSING_FAILED';
      job.status = 'failed';
      job.error = { code, message: code === 'AI_CALL_LIMIT' ? 'Лимит распознавания исчерпан.'
        : code === 'UPLOAD_TIMEOUT' ? 'Истекло время распознавания. Попробуйте файл меньшего размера.'
          : 'Не удалось распознать файл. Проверьте содержимое и отсутствие пароля.' };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', rejectAbort);
      job.file.bytes = undefined;
      this.active -= 1;
      this.drain();
    }
  }
}
