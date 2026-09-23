# Frontend ↔ Backend

Интерфейс расположен в `frontend/` и использует [общий контракт API](backend-api.md).
Backend и каталог находятся в том же репозитории: отдельные worktree не нужны.

Из корня проекта:

```sh
npm run setup
npm run dev
```

Vite автоматически проксирует `/api` на порт Backend. Для собранного режима:
`npm run build`, затем `npm start`; Express обслуживает UI и API вместе.
В Docker Frontend работает в отдельном Nginx-контейнере: `/api` проксируется
в сервис `backend`, а `/cart` обслуживается как маршрут SPA.

Если Frontend размещён отдельно, `VITE_API_BASE_URL` может содержать origin
Backend или полный префикс с `/api`. Например, `http://localhost:3001` и
`http://localhost:3001/api` приводят к одинаковым URL запросов. Значение задаётся
при запуске Vite или сборке. Без настройки используется `/api` текущего origin.

## Модули

- `src/lib/api.ts`: создание и восстановление сессии, поиск и корзина.
- `src/App.tsx`: оверлей, история диалогов, карточки, явное подтверждение и экран серверной корзины.
- `src/ProductEvidence.tsx`: характеристики, склады и сертификаты из ответа API.
- `src/UploadPanel.tsx`, `src/uploadText.ts`, `src/uploadStyles.css`: вложения и ручная проверка распознанных позиций, RU/KK.
- `src/lib/uploads.ts`, `src/uploadTypes.ts`: проверка контракта, передача файла, статусы и удаление задания.
- `src/lib/links.ts`: допустимые HTTP/HTTPS-ссылки на источники и сертификаты.

## Поведение

- `POST /api/session` runs before search or cart requests. The shared cart session ID is kept in this browser tab's `sessionStorage`; each separate chat gets its own in-memory search session. Both use `X-Session-Id`.
- Search reads `POST /api/search`; price, stock, properties, explanations, and certificate links come from that response.
- Only the explicit confirmation button sends `POST /api/cart`. Retries reuse its `confirmationId`.
- Successful confirmation opens the local cart screen using `cartUrl` from the response. Refreshing that route reads `GET /api/cart` with the same session.
- The prototype cart is on the backend server. It is not the live ekt.kz cart, because the partner API has no cart mutation endpoint.
- Attachments use the [upload contract](uploads-api.md); upload and recognition never mutate the cart.

## Separate chats and history

- **История чатов** opens a list of separate dialogs titled by their first question (or unsent draft); **Новый чат** opens a fresh dialog. Selecting a list item restores its transcript and unsent draft. Repeated New clicks reuse the current empty dialog. Escape from history returns to the chat; the active item is marked in the list.
- Chats, drafts, and the selected dialog are saved to this origin's `localStorage` under `ekt-assistant-chat-history` (version 1). Refreshing or reopening in the same browser restores them. This is not account sync or encrypted storage: other people using the browser profile can read the history. Avoid sensitive/payment data and clear history on shared devices. API session credentials and cart confirmations are never included in this snapshot.
- All restored results are read-only historical snapshots. Send a new query to check current price and stock before purchase. Interrupted searches become errors and are never replayed automatically. Backend search sessions remain in memory only, so after refresh repeat the article/characteristics rather than relying on a saved conversation's context.
- **Удалить чат** and **Очистить историю** require confirmation and affect only browser history, not the cart or server-held data. Cancellation/Escape returns keyboard focus to the initiating control. Failed storage writes do not claim successful deletion. Clearing/deleting the last chat leaves one empty dialog.
- Storage is validated and bounded (2 MiB conservative UTF-16 size, 100 chats, 500 turns per chat, 10,000-character drafts/questions). Invalid/unsupported data, blocked storage, or size/quota errors show a warning; chatting remains available in memory without silently truncating existing history. Another tab's history write pauses this tab's saves/deletions until refresh to avoid restoring stale deleted data; copy unsaved drafts before refreshing.
- `searchCatalog(query, chatId)` creates/reuses an independent backend search session per dialog. The wire body is `{ query, conversation: true }`; transcripts are not sent by the browser. Switching chats does not create API requests or change the shared cart session. Cart mutations still use the shared cart session and explicit SKU/quantity/confirmation ID, never the search-session ID.
- Follow-ups stay within their dialog's session. With `conversation: true`, the backend retains the last 8 messages, pending technical specifications, and the last exact-match SKU. Selecting an upload candidate or an alternative does not change that search context. An expired search session is recreated only for that chat; repeat the article if a follow-up cannot be understood. Cart state is unaffected by search-session recovery.
- Test: in chat A send `DEMO-MCB-003`; start chat B and send `DEMO-MCB-001`. Open history, select chat A, and send `А есть 12 штук?`. Confirm the response is about `DEMO-MCB-003`. Verify a draft survives A/B switching and no cart mutation occurs until confirmation.
- Submitting a new question immediately disables purchase actions on all earlier result cards, which remain labeled as historical snapshots. Only the latest successful result can open a fresh confirmation; pending cart retry/review controls remain available independently.
- History/New controls are disabled during an in-flight search or cart request and while confirmation is open. Failed cart requests remain reviewable with their original SKU, quantity, and confirmation ID even after a chat switch. Each turn retains its own language and requested quantity. The transcript follows new replies only when already near its bottom (or when the user submits); it never scrolls the host page.
- After a timeout, network failure, or server error, new product selections are blocked until the original cart attempt is resolved through **Проверить добавление**. A definitive stock rejection does not block choosing a different product.

Run `npm run test` and `npm run build` to verify the frontend.

## Failed question recovery

- The latest non-restored failed question offers **Повторить вопрос** / **Сұрақты қайталау** for network failures, timeouts, server errors, and unexpected client exceptions. Rejected HTTP 4xx requests do not get a blind retry button; correct the question or try again later as appropriate.
- A manual retry appends a fresh attempt using the original question, original language normalization, and the same chat session. The original error stays visible and any unsent draft is preserved. Focus moves to the composer before the retry button disappears. Concurrent sends are blocked, and no cart request is made.
- Older/restored failed questions are not replayed: their server-side context may be missing or changed. Enter a new question with the article/characteristics. Search timeout wording does not imply that a cart operation happened; cart timeout/retry behavior is unchanged.
- Optional `notice` values (`AI_OFFLINE`, `AI_UNAVAILABLE`, `AI_CALL_LIMIT`) are shown as localized AI-availability notices. They are not cache/live provenance flags. The UI does not invent provenance or substitute canned answers. Restored and previous results retain their historical-data warnings.

## Document and photo attachments

- Open **Прикрепить файл** / **Файл тіркеу** inside the chat. `GET /api/uploads/capabilities` controls availability, allowed extensions, size, polling interval, and result lifetime. In offline mode file selection is disabled with an explanation; text search remains available. Actual recognition requires backend `APP_MODE=live` and `OPENAI_API_KEY`; see [backend configuration](uploads-api.md).
- One selected file is validated locally before transfer. Selection itself makes no upload request. **Распознать файл** creates a dedicated in-memory upload session, then sends multipart `file` and UUID `requestId` with `X-Session-Id`. Every status/delete/retry request stays bound to that session, independently of chat search and shared cart sessions.
- The progress bar reports real byte-transfer progress only. Recognition shows queued/processing states and polls sequentially; no invented recognition percentage. A timeout/network failure offers manual retry with the same file, request ID, and session. Failed polling retries the status request, not the upload. Expired sessions/jobs require an explicit new attempt; no silent replay.
- Extracted text, quantities, units, warnings, truncation, and catalog candidates are displayed as text. Unknown quantity remains blank, not 1; units are not converted or guessed. Each line requires manual quantity/unit review and a checked acknowledgement before selecting a candidate. The existing confirmation dialog still requires a separate explicit add action. Backend stock and pack validation remains authoritative.
- Upload results expire at server `expiresAt`, including an already-open but unsubmitted cart confirmation. An uncertain cart request that was already submitted retains its original confirmation ID and can still be reconciled after upload expiry. **Отменить и удалить файл** calls the upload DELETE endpoint and locks conflicting controls until completion.
- Each chat keeps its own file/result in memory. New chat never reuses a chat containing a selected file; attachment-only dialogs use the filename as their temporary title. Closing/reopening, switching chats, and returning from the cart preserve that memory during the page lifetime. Closing during transfer aborts the browser request and offers explicit idempotent retry on return; polling resumes when the chat is reopened.
- Files, extracted results, upload IDs, and upload-session credentials are not written to browser history/localStorage. Refresh loses attachment state. Deleting browser history is not a server-delete operation; use the upload delete button or server expiry. The UI warns that recognition sends file contents to OpenAI and not to include personal/payment data. Server retention details are in the upload contract.

### Attachment verification

1. With an enabled backend, choose a small supported synthetic specification. Verify nothing transfers before **Распознать файл**; then observe transfer and processing states.
2. Review extracted items, especially unknown quantity/unit, unmatched lines, warnings and multiple candidates. Set a valid quantity and check the review acknowledgement.
3. Select a candidate. Verify the cart remains unchanged until the confirmation button is pressed; after success, the returned `cartUrl` shows the updated server cart. Return to chat to review remaining lines.
4. Test oversized/unsupported files, lost connection/manual retry, session expiry, result expiry, cancel/delete, and a second independent chat. Do not use personal files for QA.
5. Automated transport/UI/integration regressions: `npm --prefix frontend run test -- src/lib/uploads.test.ts src/UploadPanel.test.tsx src/UploadIntegration.test.tsx`. These use synthetic files and mocked recognition; they do not prove provider OCR quality or spend OpenAI credits.

## Quantity before confirmation

- Fresh product results open a confirmation dialog with the requested quantity, editable number input, minus/plus buttons, and a live line total. No cart request is sent until the explicit confirmation button is pressed.
- Quantity must be a positive safe integer, no greater than the displayed stock, and a multiple of `minimumOrderQuantity` (default 1). This field is a pack multiple in the backend cart contract, not merely a lower bound. Typed invalid values show an error rather than being silently clamped. Step buttons move between valid pack multiples.
- If a requested quantity exceeds positive stock or has the wrong pack multiple, **Изменить количество** lets the buyer correct it. Zero-stock products, unavailable full packs, and historical/restored cards remain unpurchasable.
- On the first submission, the SKU, edited quantity, and confirmation ID are captured together. Quantity controls then remain locked during loading and retries, including after hiding/reopening the request. The backend still rechecks availability including quantities already in the shared cart; rejection is shown without navigating to the cart. A definitive rejection can be closed and a fresh selection opened, while uncertain outcomes must be resolved through the original retry.
- Check: request 8 units, edit to 3 and verify the total, enter 0 or a value above stock and verify confirmation is disabled, then restore a valid value. Confirm explicitly and inspect the returned cart. Timeout retry must reuse exactly the submitted SKU, quantity, and confirmation ID.

## Product evidence

- Each card has a keyboard-operable **Характеристики и наличие** disclosure. It shows the normalized fields returned by the API plus all catalog properties, not only the first three. Zero and boolean values are retained; empty/null values are labelled missing, and structured values are labelled unsupported rather than guessed or rendered as HTML. Raw catalog text is not translated.
- Alternative cards display the backend's `reason` under **Почему предложен аналог**, with a caution that listed parameter matches do not guarantee complete interchangeability. Missing reasons and `technicalIssue` warnings remain explicit. No client-side compatibility inference is performed.
- **Сертификаты** has named HTTP(S) links and a new-tab indication. Unsafe/malformed/credential-bearing links are not clickable. Missing certificates are described as not provided by this response, not as proof that no certificate exists.
- Optional `product.stores` uses the existing backend catalog schema: `{ id: integer, name: string, quantity: nonnegative number }[]`. Available rows show their exact quantities, including zero. Missing/empty breakdowns are labelled unavailable; total stock is not allocated to invented locations. This optional field is validated and retained in saved history without breaking older saved data.
- Evidence disclosures do not make API requests or change the cart. Restored results remain historical and unpurchasable until rechecked; expanding details does not refresh prices or stock.
