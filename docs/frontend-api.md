# Frontend ↔ EKT assistant API

The frontend follows the contract in [`server/API.md`](https://github.com/BAITC-Hacks/hack-ddb369dc-saq-digital/blob/feature/ekt-assistant-prototype/server/API.md). The backend and 40-SKU catalog currently live on separate team branches; they must be available together at runtime.

## Local run while team branches are separate

From the frontend repository root:

```sh
git fetch origin
git worktree add ../ekt-api origin/feature/ekt-assistant-prototype
git worktree add ../ekt-data origin/feature/data-demo-docs
cd ../ekt-api/server
npm install --no-package-lock
CATALOG_PATH=../../ekt-data/data/catalog.json npm start
```

In a second terminal, from the frontend repository root:

```sh
npm install
VITE_API_BASE_URL=http://127.0.0.1:3001 npm run dev
```

Open the URL printed by Vite. Use the `Demo` button in the chat. The server should return `DEMO-MCB-001` with insufficient stock and at least one alternative. Select `DEMO-MCB-003`, press **Да, добавить**, and verify that the browser opens the cart route from the API response with 8 units of that product.

After the backend and catalog branches are merged, run the server from this repository's `server/` directory and use its default catalog path. The frontend still needs `VITE_API_BASE_URL` when Vite and the API run on different origins. In a same-origin deployment, leave it unset; requests use `/api`.

## State and limitations

- `POST /api/session` runs before search or cart requests. The shared cart session ID is kept in this browser tab's `sessionStorage`; each separate chat gets its own in-memory search session. Both use `X-Session-Id`.
- Search reads `POST /api/search`; price, stock, properties, explanations, and certificate links come from that response.
- Only the explicit confirmation button sends `POST /api/cart`. Retries reuse its `confirmationId`.
- Successful confirmation opens the local cart screen using `cartUrl` from the response. Refreshing that route reads `GET /api/cart` with the same session.
- The prototype cart is on the backend server. It is not the live ekt.kz cart, because the partner API has no cart mutation endpoint.
- The current API supports text queries only. File uploads are not submitted.

## Separate chats and history

- **История чатов** opens a list of separate dialogs titled by their first question (or unsent draft); **Новый чат** opens a fresh dialog. Selecting a list item restores its transcript and unsent draft. Repeated New clicks reuse the current empty dialog. Escape from history returns to the chat; the active item is marked in the list.
- Chats, drafts, and the selected dialog are saved to this origin's `localStorage` under `ekt-assistant-chat-history` (version 1). Refreshing or reopening in the same browser restores them. This is not account sync or encrypted storage: other people using the browser profile can read the history. Avoid sensitive/payment data and clear history on shared devices. API session credentials and cart confirmations are never included in this snapshot.
- All restored results are read-only historical snapshots. Send a new query to check current price and stock before purchase. Interrupted searches become errors and are never replayed automatically. Backend search sessions remain in memory only, so after refresh repeat the article/characteristics rather than relying on a saved conversation's context.
- **Удалить чат** and **Очистить историю** require confirmation and affect only browser history, not the cart or server-held data. Cancellation/Escape returns keyboard focus to the initiating control. Failed storage writes do not claim successful deletion. Clearing/deleting the last chat leaves one empty dialog.
- Storage is validated and bounded (2 MiB conservative UTF-16 size, 100 chats, 500 turns per chat, 10,000-character drafts/questions). Invalid/unsupported data, blocked storage, or size/quota errors show a warning; chatting remains available in memory without silently truncating existing history. Another tab's history write pauses this tab's saves/deletions until refresh to avoid restoring stale deleted data; copy unsaved drafts before refreshing.
- `searchCatalog(query, chatId)` creates/reuses an independent backend search session per dialog. The wire body remains `{ "query": "..." }`; no new fields or transcript are sent. Switching chats does not create API requests or change the shared cart session. Cart mutations still use the shared cart session and explicit SKU/quantity/confirmation ID, never the search-session ID.
- Follow-ups stay within their dialog's session. The backend remembers the last **exact-match SKU**, not a selected alternative or unrestricted conversation context. An expired search session is recreated only for that chat; repeat the article if a follow-up cannot be understood. Cart state is unaffected by search-session recovery.
- Test: in chat A send `DEMO-MCB-003`; start chat B and send `DEMO-MCB-001`. Open history, select chat A, and send `А есть 12 штук?`. Confirm the response is about `DEMO-MCB-003`. Verify a draft survives A/B switching and no cart mutation occurs until confirmation.
- Submitting a new question immediately disables purchase actions on all earlier result cards, which remain labeled as historical snapshots. Only the latest successful result can open a fresh confirmation; pending cart retry/review controls remain available independently.
- History/New controls are disabled during an in-flight search or cart request and while confirmation is open. Failed cart requests remain reviewable with their original SKU, quantity, and confirmation ID even after a chat switch. Each turn retains its own language and requested quantity. The transcript follows new replies only when already near its bottom (or when the user submits); it never scrolls the host page.
- After a timeout, network failure, or server error, new product selections are blocked until the original cart attempt is resolved through **Проверить добавление**. A definitive stock rejection does not block choosing a different product.

Run `npm run test` and `npm run build` to verify the frontend.

## Failed question recovery

- The latest non-restored failed question offers **Повторить вопрос** / **Сұрақты қайталау** for network failures, timeouts, server errors, and unexpected client exceptions. Rejected HTTP 4xx requests do not get a blind retry button; correct the question or try again later as appropriate.
- A manual retry appends a fresh attempt using the original question, original language normalization, and the same chat session. The original error stays visible and any unsent draft is preserved. Focus moves to the composer before the retry button disappears. Concurrent sends are blocked, and no cart request is made.
- Older/restored failed questions are not replayed: their server-side context may be missing or changed. Enter a new question with the article/characteristics. Search timeout wording does not imply that a cart operation happened; cart timeout/retry behavior is unchanged.
- The current search contract supplies no cache/live provenance flag. The UI does not invent one or substitute canned answers. Restored and previous results retain their existing historical-data warnings.

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
- Optional `product.stores` uses the existing backend catalog schema: `{ id: integer, name: string, quantity: nonnegative integer }[]`. Available rows show their exact quantities, including zero. Missing/empty breakdowns are labelled unavailable; total stock is not allocated to invented locations. This optional field is validated and retained in saved history without breaking older saved data.
- Evidence disclosures do not make API requests or change the cart. Restored results remain historical and unpurchasable until rechecked; expanding details does not refresh prices or stock.
