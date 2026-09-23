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

- `POST /api/session` runs before search or cart requests. The ID is kept in this browser tab's `sessionStorage` and sent in `X-Session-Id`.
- Search reads `POST /api/search`; price, stock, properties, explanations, and certificate links come from that response.
- Only the explicit confirmation button sends `POST /api/cart`. Retries reuse its `confirmationId`.
- Successful confirmation opens the local cart screen using `cartUrl` from the response. Refreshing that route reads `GET /api/cart` with the same session.
- The prototype cart is on the backend server. It is not the live ekt.kz cart, because the partner API has no cart mutation endpoint.
- The current API supports text queries only. File uploads are not submitted.

Run `npm run test` and `npm run build` to verify the frontend.
