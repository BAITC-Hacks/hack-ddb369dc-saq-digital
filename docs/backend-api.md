# EKT assistant backend contract

The backend API returns JSON. Prices are in tenge (`priceKzt`), electrical breaking capacity is in kA (`breakingCapacityKa`). This document is for the frontend and data owners.

File uploads use multipart requests and asynchronous jobs. See the [upload contract](uploads-api.md) for session headers, supported formats, limits, extracted lines, polling, cancellation and errors. `GET /api/uploads/capabilities` is public and remains available during catalog import.

## Starting the backend

From the repository root, run `npm run setup` and `npm run dev` for the integrated project. Run `npm run build` followed by `npm start` to serve the built frontend and API from one process. For backend-only development, use `npm --prefix backend run dev`. Defaults are in `backend/config.json`; `PORT` and `CATALOG_PATH` override them. The backend validates `data/catalog.json` at startup.

`APP_MODE` defaults to offline. In `live` mode, setting both `EKT_API_USERNAME` and `EKT_API_PASSWORD` replaces the demo catalog with data from the partner read API. The backend paginates `/api/products` and fetches each product's detail to obtain verified price, stock and specifications. It does not require partner IDs in the local catalog. An incomplete/empty page or a repeated first page ends pagination. Failed/invalid details and ambiguous duplicate SKUs are excluded; a page error or an entirely unusable catalog fails the import. Demo entries are never substituted in this mode. The detail URL is configured in `backend/config.json` and may be overridden with `EKT_PRODUCT_DETAIL_URL`; the list URL is its parent path, unless `partnerProductsUrl` is set in that JSON. `partner` controls page limit, concurrency and timeout. Never put credentials in the repository.

The first import without a disk cache runs in the background and may take several minutes. Complete validated snapshots are saved atomically to `backend/.cache/ekt-catalog.json` by default. Subsequent launches restore the catalog before listening. `partner.cache.path` (relative to backend), `partner.cache.maxAgeMs` (one hour), and optional `EKT_CATALOG_CACHE_PATH` control caching. A fresh cache skips import; an expired cache remains usable while refreshing. Periodic refresh runs after the age interval. Refresh failure preserves the previous snapshot; invalid/incompatible caches are ignored. Cache identity includes API endpoints and account identity without storing credentials. The current Docker setup does not persist the cache across container recreation.

`GET /api/health` stays available with HTTP 200 and returns optional `catalog`: `status` (`loading`, `ready`, `failed`), `source`, `products`, progress fields `pages`, `listed`, `completed`, `failed`, and snapshot timestamp `loadedAt`. Partner mode adds `cached`, `refreshing`, `stale`, optional `cacheSaved` and `refreshError`. `ready` with `refreshing: true` means the old snapshot is usable during an update. HTTP 200 alone does **not** imply product lookup is ready.

Without a usable catalog, `POST /api/session` and `GET /api/cart` work immediately. Purchase terms and basic greetings/help work locally. `POST /api/search` with `conversation: true` returns a normal conversation response with notice `CATALOG_LOADING` or `CATALOG_UNAVAILABLE` for product requests, without AI calls or invented availability. Classic product search, cart writes and uploads still return HTTP 503 (loading includes `Retry-After: 10`). Existing sessions can use products once import finishes. Responses from a ready partner search have optional `catalog: { source, loadedAt, cached, refreshing, stale }`; stale/refreshing responses also include a timestamp note in `answer`. Existing required fields remain unchanged. Repeated conversation answers are invalidated when the snapshot changes.

This is a read-only partner integration; the cart does not reserve partner stock. Price/stock checks use the latest complete local snapshot, not an individual partner request at confirmation time. Previously accepted cart lines retain their price; new additions check current snapshot data. Deployments with several backend processes need coordinated shared catalog storage and refresh.

Frontend integration: use `catalog.source` for the catalog label, show import progress until `ready`, and offer retry for `CATALOG_LOADING`. The existing synthetic demo query only applies to the local catalog. No search/cart success response fields have been removed or renamed.

If `OPENAI_API_KEY` is set in live mode, the OpenAI Responses API handles conversation or extracts technical filters when local parsing cannot understand a query. The default model is `gpt-4.1-mini`; `OPENAI_MODEL` and `OPENAI_RESPONSES_URL` override `backend/config.json`. Requests use [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and `store: false`. In the original search mode, missing specifications are returned as `null` and rejected locally, preserving the HTTP 422 clarification response. The optional conversation mode described below supports general site questions and follow-up clarification. Zod rejects extra fields such as SKU, price, or stock. Analog explanations and product selection still come from catalog data.

The adapter caches successful normalized requests together with conversation context, shares in-flight requests, and limits calls, output tokens, and request time using `backend/config.json` (20 attempts per process, 768 output tokens, 15 seconds by default). Failed requests are removed from the cache and still count toward the limit; no automatic retries are made. Without the key, the local parser remains available. OpenAI credentials stay on the server. The previous `NVIDIA_*` settings have been replaced by `OPENAI_*`.

## Catalog format for the data owner

The file is a JSON array. The data team's 40-SKU demo catalog uses this format:

```json
[
  {
    "sku": "DEMO-MCB-003",
    "name": "Автомат Demo Power 3P C16 15 kA",
    "brand": "Demo Power",
    "poles": 3,
    "curve": "C",
    "amps": 16,
    "breakingCapacity": 15,
    "price": 7900,
    "currency": "KZT",
    "stock": 12
  }
]
```

The backend maps `breakingCapacity` to `breakingCapacityKa` and `price` to `priceKzt` in API responses. It also accepts full detail objects from the partner's `/api/products/detail?id=...` endpoint, with `id`, `article`, `name`, `price`, `quantity`, `properties`, and optional `stores`, `description`, `url`, `image`. For those, `article` becomes `sku`, `price` becomes `priceKzt`, and `quantity` becomes `stock`. An optional `certificates` array contains `{ "name": "...", "url": "https://..." }` entries when the data source has them. Never invent a certificate URL.

Partner `stock`, warehouse quantities and nominal current may be fractional numbers and are not rounded. Missing, conflicting or nonpositive nominal current is represented by `amps: null` rather than dropping the entire product. Original properties remain available for inspection; invalid/conflicting ratings include `technicalIssue`. The cart request contract still requires positive integer quantities.

Technical alternatives need verified `poles`, `curve`, `amps`, and `breakingCapacityKa`. The partner sample has conflicting current ratings in the name and properties; such a product is shown for article inquiries but excluded from automatic compatibility matching until corrected.

## Health

`GET /api/health` returns HTTP 200 with `{ "status": "ok" }` after the catalog is loaded and the server is listening. It requires no session, does not change cart state, and does not contact OpenAI or the partner API. Docker uses it for readiness. It does not assert external service availability.

## Session and cart

1. `POST /api/session` with an empty JSON object returns `{ "sessionId": "..." }` (HTTP 201).
2. Store `sessionId` for the demo session and send it in the `X-Session-Id` header on cart requests. Every session has its own cart.
3. `GET /api/cart` returns `{ "items": [], "totalPriceKzt": 0, "cartUrl": "/cart" }` before confirmation. The frontend should serve its cart screen at the configured `cartUrl`. Set `CART_URL` to another frontend route if needed.
4. After the user explicitly presses the confirmation button, send `POST /api/cart` with `X-Session-Id` and this body:

```json
{ "sku": "DEMO-MCB-003", "quantity": 8, "confirmed": true, "confirmationId": "unique-id-for-this-confirmation" }
```

The response includes updated `items`, `totalPriceKzt`, and `cartUrl`. Each item includes `sku`, `name`, `quantity`, `unitPriceKzt`, and `lineTotalKzt`. Use a new `confirmationId` for each distinct confirmation and reuse it for retries. Repeated delivery cannot add twice; reusing an ID for a different SKU or quantity returns HTTP 409. Cart state is in server memory and resets on restart. The provided partner API has no cart mutation endpoint, so this is the prototype cart; linking to ekt.kz's cart would show unrelated state.

## Chat search

The frontend opts into conversational replies with `{ "query": "что по товарам есть", "conversation": true }`. This optional flag preserves the original search contract for clients that only send `query`, including HTTP 422 for missing specifications.

Conversational responses use the same fields, with `intent: "conversation"`, a textual `answer`, `filters: null`, `exactMatch: null`, and `alternatives: []`. A reply need not contain product cards. OpenAI receives the local catalog, purchase terms, the last 8 messages from this session, and pending technical specifications. Unknown facts must be described as unavailable; off-topic replies are replaced with a site-only redirect. Off-topic input is excluded from subsequent model history. The model cannot add items to a cart.

For a partial technical selection, the backend remembers known fields and asks only for missing fields. Once all fields are valid, deterministic catalog search returns the existing `specifications` response. Model-generated search text does not replace catalog prices or results. Immediate retries of the same successful question do not duplicate history or spend another call. State and history are isolated by `X-Session-Id` and reset with the backend process. Conversational messages are limited to 4000 characters (`QUERY_TOO_LONG`, HTTP 400).

If OpenAI is disabled, unavailable, or its process call limit is exhausted, the frontend receives a readable fallback reply with optional `notice: "AI_OFFLINE" | "AI_UNAVAILABLE" | "AI_CALL_LIMIT"`. Local article lookup, full specification queries, and purchase terms continue to work. Logs contain only a failure category and HTTP status when available, never the API key or provider response body.

`POST /api/search` accepts `{ "query": "Нужен автомат 3P C16, 10 kA, 8 штук" }` and returns:

```json
{
  "intent": "specifications",
  "answer": "Точного товара в нужном количестве нет. Найдены варианты по указанным техническим параметрам.",
  "filters": { "poles": 3, "curve": "C", "amps": 16, "breakingCapacityKa": 10, "quantity": 8 },
  "exactMatch": { "product": { "sku": "...", "name": "...", "priceKzt": 12000, "stock": 2 }, "canFulfill": false },
  "alternatives": [{ "product": { "sku": "...", "name": "...", "priceKzt": 14000, "stock": 10 }, "reason": "..." }]
}
```

`exactMatch` is `null` when absent. There are at most two alternatives. They have the same poles, curve, and current rating, at least the requested breaking capacity, and enough stock. Search never changes the cart.

Send `X-Session-Id` with search requests to preserve the last discussed product for follow-up questions such as “А сертификат есть?”. Search also works without a session for single-turn inquiries.

An inquiry containing an article from the local catalog returns `intent: "product"`, a product answer with price and stock, all available `properties`, certificates when provided, and alternatives when the item is unavailable and its technical ratings are complete. A purchase question about payment, delivery, or minimum batch returns `intent: "purchase_terms"`, an `answer`, and `sourceUrl` pointing to the [partner's published terms](https://ekt.kz/about/information/). A universal minimum batch is not stated there; the answer says so rather than guessing.

Errors use `{ "error": { "code": "...", "message": "..." } }` and an appropriate HTTP status (400, 401, 404, 409, or 422).

Product inquiries also return a top-level `quantity` alongside the existing fields. This preserves the requested quantity when `filters` is `null` because technical specifications are incomplete. The frontend uses it first, then `filters.quantity` for specification searches. A new specification query starts a fresh search rather than reusing the previous product from the session.
