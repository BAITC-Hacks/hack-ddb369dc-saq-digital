# EKT assistant API

This is the backend contract for the frontend and demo catalog. The API returns JSON. Prices are integer tenge. `breakingCapacityKa` is measured in kA.

## Catalog

The backend reads `data/catalog.json` at startup. `CATALOG_PATH` can point to another JSON file. The file is an array of products:

```json
[
  {
    "sku": "DEMO-001",
    "name": "Демонстрационный автомат 3P C16 10 kA",
    "poles": 3,
    "curve": "C",
    "amps": 16,
    "breakingCapacityKa": 10,
    "priceKzt": 12000,
    "stock": 2
  }
]
```

`sku` must be unique. The price and stock in this example are synthetic; the data team will provide the demo catalog.

## POST /api/search

Request: `{ "query": "Нужен автомат 3P C16, 10 kA, 8 штук" }`.

Response:

```json
{
  "filters": { "poles": 3, "curve": "C", "amps": 16, "breakingCapacityKa": 10, "quantity": 8 },
  "exactMatch": { "product": { "sku": "...", "name": "...", "poles": 3, "curve": "C", "amps": 16, "breakingCapacityKa": 10, "priceKzt": 12000, "stock": 2 }, "canFulfill": false },
  "alternatives": [{ "product": { "sku": "...", "name": "...", "poles": 3, "curve": "C", "amps": 16, "breakingCapacityKa": 15, "priceKzt": 14000, "stock": 10 }, "reason": "..." }]
}
```

`exactMatch` is `null` if none exists. `alternatives` contains at most two products with the same poles, curve, and current rating, sufficient stock, and breaking capacity at least as high as requested. Search does not change the cart.

## GET /api/cart

Returns `{ "items": [], "totalPriceKzt": 0 }` before the first confirmation.

## POST /api/cart

Send only after the user presses **Confirm and add to cart**:

```json
{ "sku": "DEMO-001", "quantity": 8, "confirmed": true, "confirmationId": "unique-id-for-this-click" }
```

Returns `{ "items": [{ "sku": "...", "name": "...", "quantity": 8, "unitPriceKzt": 12000, "lineTotalKzt": 96000 }], "totalPriceKzt": 96000 }`.

Use a new `confirmationId` for each distinct confirmation and reuse it on retries. Repeated requests with the same ID and payload do not add the product again. A reused ID with a different product or quantity returns HTTP 409. The cart is held in server memory and resets when the server restarts.

Errors use `{ "error": { "code": "...", "message": "..." } }` with HTTP 400, 404, 409, or 422.
