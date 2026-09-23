# Загрузка спецификаций и фотографий — контракт для Frontend

Статус: реализован в Backend, ветка `feature/document-uploads`.
Файлы распознаются через OpenAI; цены, остатки и кандидаты берутся только из
каталога Backend. Загрузка и распознавание **никогда не изменяют корзину**.

## Форматы и ограничения

- Один файл на запрос: `.jpg`, `.jpeg`, `.png`, `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`.
- По умолчанию максимум **921600 байт (900 КиБ)**. Лимит учитывает текущий Nginx
  с ограничением HTTP-body 1 МиБ; multipart-запрос ограничен отдельно.
- Проверяются расширение, MIME и сигнатура контейнера. Повреждённые или
  зашифрованные документы могут завершиться ошибкой распознавания.
- До 50 извлечённых строк. Если строк больше, `truncated: true`; результат
  требует ручной проверки. Количество без явного указания остаётся `null`.
- PDF и фото поддерживают визуальное распознавание. Для Word извлекается текст;
  картинки внутри Word следует отправлять отдельно или преобразовать документ
  в PDF. Для Excel сервис читает первые 1000 строк каждого листа.
- Файл передаётся в OpenAI для распознавания. На сервере файл хранится только
  в памяти до завершения/отмены обработки. Результат хранится 15 минут; его можно
  удалить раньше. Перезапуск Backend удаляет задания и сессии.

Настройки доступны через `GET /api/uploads/capabilities` (без сессии):

```json
{
  "enabled": true,
  "maxFiles": 1,
  "maxFileBytes": 921600,
  "maxItems": 50,
  "resultTtlSeconds": 900,
  "pollIntervalMs": 1000,
  "formats": [
    { "extensions": [".jpg", ".jpeg"], "mimeType": "image/jpeg" },
    { "extensions": [".png"], "mimeType": "image/png" },
    { "extensions": [".pdf"], "mimeType": "application/pdf" },
    { "extensions": [".doc"], "mimeType": "application/msword" },
    { "extensions": [".docx"], "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { "extensions": [".xls"], "mimeType": "application/vnd.ms-excel" },
    { "extensions": [".xlsx"], "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  ]
}
```

`enabled` требует `APP_MODE=live` и `OPENAI_API_KEY`. Каталог может быть локальным
или партнёрским. Во время импорта каталога upload/poll подчиняются существующим
ошибкам `CATALOG_LOADING` / `CATALOG_UNAVAILABLE`; capabilities доступен всегда.
Текущий Nginx заменяет ответы HTTP 503 на `BACKEND_UNAVAILABLE`; интерфейс должен
обрабатывать и этот код. Запросы, превышающие лимит самого прокси, могут получить
HTTP 413 без JSON — показывайте ошибку размера по HTTP-статусу.

## Загрузка

1. Получите сессию через `POST /api/session`.
2. Создайте UUID `requestId` при выборе файла, сохраните его для повторной отправки.
3. Отправьте `POST /api/uploads` с заголовком **`X-Session-Id`** и `FormData`:
   `file` — один File; `requestId` — UUID. Других полей нет.
4. Не задавайте `Content-Type` вручную: браузер должен добавить multipart boundary.

```typescript
const form = new FormData()
form.append('file', file)
form.append('requestId', requestId) // crypto.randomUUID(), один на попытку
const response = await fetch('/api/uploads', {
  method: 'POST', headers: { 'X-Session-Id': sessionId }, body: form,
})
const job = await response.json()
```

Новый запрос возвращает **HTTP 202**. Повтор с тем же `requestId` и тем же
файлом в этой сессии возвращает то же задание: 202 для активного, 200 для
завершённого. Другой файл/имя с тем же ID — HTTP 409 `UPLOAD_CONFLICT`.
После ошибки распознавания новая попытка использует новый `requestId`.
После сетевой ошибки повторяйте старый ID, чтобы не оплачивать распознавание дважды.

```json
{
  "uploadId": "3a67a7f5-f45f-4fd2-897b-658fb973795b",
  "requestId": "c09e79ac-5cf2-4b49-b34b-6d4f004699dc",
  "status": "queued",
  "file": { "name": "specification.pdf", "mimeType": "application/pdf", "sizeBytes": 23456 },
  "createdAt": "2026-09-23T12:00:00.000Z",
  "expiresAt": "2026-09-23T12:15:00.000Z",
  "items": [],
  "warnings": [],
  "truncated": false,
  "error": null
}
```

## Статус и результат

`GET /api/uploads/:uploadId` с тем же `X-Session-Id` возвращает HTTP 200 и
тот же объект. Опрос — раз в секунду, до `completed` или `failed`.
Состояния: `queued` → `processing` → `completed` / `failed`.
Процент распознавания серверу неизвестен: показывайте этап, а не выдуманный процент.
Прогресс передачи файла можно получать через `XMLHttpRequest.upload.onprogress`.

При `completed` поле `items` содержит извлечённые позиции, например:

```json
{
  "lineId": "1",
  "description": "Автомат Demo Power 3P C16 15 kA",
  "article": "DEMO-MCB-003",
  "quantity": 8,
  "unit": "шт",
  "sourceText": "DEMO-MCB-003, 8 шт",
  "specifications": { "poles": 3, "curve": "C", "amps": 16, "breakingCapacityKa": 15 },
  "matchStatus": "matched",
  "matchCount": 1,
  "candidates": [{
    "product": { "sku": "DEMO-MCB-003", "name": "Автомат Demo Power 3P C16 15 kA", "priceKzt": 7900, "stock": 12 },
    "reason": "Совпадает артикул из файла.",
    "canFulfill": true,
    "canAddToCart": true
  }],
  "warnings": [],
  "requiresReview": true
}
```

Пример использует синтетический SKU из offline-каталога. `product` имеет тот же
формат, что в `/api/search`, и может содержать дополнительные характеристики.
`matched` — один кандидат; `ambiguous` — несколько; `not_found` — ни одного.
Возвращается до трёх кандидатов, `matchCount` показывает полное число совпадений.
Сопоставление: точный артикул/SKU; если артикула нет — полный набор технических
параметров. При неизвестном артикуле похожий товар автоматически не подставляется.

`quantity`, `unit`, `article` и отдельные характеристики могут быть `null`.
`canFulfill: null` означает неизвестное количество; `canAddToCart` учитывает
только известные целое количество, остаток и кратность. Оно не заменяет
подтверждение клиента и не учитывает уже добавленное в корзину количество;
окончательную проверку выполняет `/api/cart`. Не угадывайте количество и единицу измерения.
`warnings` и `sourceText` показывайте как обычный текст, не HTML.

`completed` с `items: []` означает отсутствие распознанных товаров; это не
сигнал для изменения корзины. `truncated` и предупреждения показывайте пользователю.
После ручной проверки строки, выбора кандидата и явного подтверждения используйте
существующий `POST /api/cart` с новым `confirmationId`. Массового добавления нет.

## Ошибки и отмена

Ошибки HTTP имеют обычную форму `{ "error": { "code": "...", "message": "..." } }`.

| HTTP | Код | Причина |
|---|---|---|
| 400 | `INVALID_UPLOAD` | Неверные поля, UUID, multipart или несколько файлов |
| 400 | `EMPTY_FILE` / `INVALID_FILE` | Пустой файл или несовпадение сигнатуры/MIME |
| 401 | `SESSION_REQUIRED` | Нет действующей сессии |
| 404 | `UPLOAD_NOT_FOUND` | Нет задания, истёк срок или оно принадлежит другой сессии |
| 409 | `UPLOAD_CONFLICT` | ID повторно использован с другим файлом |
| 413 | `FILE_TOO_LARGE` | Превышен лимит файла или HTTP-body |
| 415 | `UNSUPPORTED_FILE_TYPE` | Не multipart или неподдерживаемое расширение |
| 429 | `UPLOAD_LIMIT` | Достигнут лимит заданий (5 на сессию, 20 на процесс) |
| 503 | `UPLOAD_PROCESSOR_UNAVAILABLE` | Распознавание не настроено |
| 503 | `CATALOG_LOADING` / `CATALOG_UNAVAILABLE` | Каталог ещё не готов |

Если сбой произошёл **после HTTP 202**, опрос вернёт HTTP 200, `status: "failed"`,
`items: []`, `error: { "code": "UPLOAD_TIMEOUT" | "AI_CALL_LIMIT" |
"UPLOAD_PROCESSING_FAILED", "message": "..." }`. Таймаут обработки — 60 секунд
после выхода из очереди; одновременно обрабатываются два задания. Распознавание
делит лимит OpenAI-запросов с чатом.

`DELETE /api/uploads/:uploadId` с `X-Session-Id` отменяет/удаляет своё задание,
возвращает HTTP 204. Повторное удаление также 204. Удаление чужого ID не раскрывает
его существование и не влияет на чужое задание. Опрос удалённого ID вернёт 404.
Отмена прекращает локальное ожидание и запрос к провайдеру; уже переданные
провайдеру данные подчиняются его политике хранения. Используется `store: false`;
на сервере оригиналы и содержимое файлов не записываются в логи или на диск.

Источник ограничений обработки: [OpenAI File inputs](https://developers.openai.com/api/docs/guides/file-inputs).

## Проверки реализации

Автотесты покрывают multipart, сигнатуры, размер, сессии, повторные запросы,
очередь, отмену, истечение срока, ошибки провайдера и отсутствие изменений
корзины. Провайдер в автотестах заменён управляемым адаптером.

Отдельно через настроенный OpenAI проверены небольшие синтетические PDF, DOCX,
XLSX и JPEG: из каждого получены исходный артикул `DEMO-MCB-003` и количество 2.
Распознавание реальных старых DOC/XLS и сложных многостраничных документов
отдельно не проверялось; результат любого распознавания требует проверки клиента.
