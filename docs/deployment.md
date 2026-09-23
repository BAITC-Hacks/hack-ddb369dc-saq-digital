# Docker и размещение EKT Match

## Локальный запуск

Нужны Docker с Linux-контейнерами и Compose v2+. На Windows достаточно
запущенного Docker Desktop. В корне проекта откройте `start.cmd` двойным кликом
или выполните:

```sh
docker compose up --build --wait --remove-orphans
```

Откройте http://localhost:8080. Запускаются два сервиса: `backend` (Express)
и `frontend` (Nginx с готовым интерфейсом). Compose сначала ждёт готовности
Backend, затем запускает Frontend и проверяет его. Оба работают в фоне.
`--remove-orphans` удаляет старый общий контейнер `app` при переходе с предыдущей
версии проекта. Первый запуск требует
интернета для загрузки базового образа и npm-пакетов. После сборки offline-демо
работает без внешних сервисов. Для повторного запуска готовой сборки достаточно
кнопки Start в Docker Desktop или `docker compose up --wait`.

```sh
docker compose ps
docker compose logs -f frontend backend
docker compose down
```

`Ctrl+C` при просмотре логов останавливает только просмотр. `down` удаляет
контейнеры и сеть этого проекта; образы остаются для следующего запуска.
`restart: unless-stopped` включает автоматический перезапуск, кроме случая,
когда контейнер остановлен вручную.

## Окружение и OpenAI

Без `.env` запускается offline-режим на порту `8080`. Скопируйте `.env.example`
в `.env`, если своего файла ещё нет. Для OpenAI достаточно:

```dotenv
APP_MODE=live
OPENAI_API_KEY=ваш_ключ_OpenAI
```

`OPENAI_MODEL` по умолчанию — `gpt-4.1-mini`. Модель должна поддерживать Responses
API и Structured Outputs. `OPENAI_RESPONSES_URL` переопределяет endpoint;
обычно он не нужен. Ключи NVIDIA не используются. OpenAI подключается независимо
от реквизитов партнёрского API: их можно оставить пустыми.

После изменения `.env` снова выполните `docker compose up --build --wait --remove-orphans`.
Обычный `docker compose restart` не перечитывает окружение контейнера.
Переменные окружения оболочки имеют приоритет над `.env`.

`APP_PORT` задаёт опубликованный порт Frontend (по умолчанию `8080`), `PORT` — порт
Backend внутри сети Docker (по умолчанию `3001`). Например, `APP_PORT=8081`
даёт http://localhost:8081 и позволяет оставить локальный Backend на `3001`.
Пустые необязательные переменные используют значения
из `backend/config.json`. В Backend рабочая папка `/app`, каталог
`/app/data/catalog.json`. В Frontend сборка лежит в `/usr/share/nginx/html`.
Если подставляете свой каталог через `CATALOG_PATH`, файл должен присутствовать
в образе либо подключаться в контейнер извне.

`.dockerignore` исключает `.env`, Git, локальные зависимости и сборки.
Ключи передаются только в окружение запущенного Backend; секреты не являются
аргументами сборки. Frontend использует `/api` на том же адресе, поэтому для
Docker не нужны `VITE_API_BASE_URL`, порт Vite и отдельная настройка proxy.

## Отдельные сервисы

`deploy/Dockerfile` содержит отдельные итоговые цели `backend` и `frontend`.
Backend — Node.js с Express, рабочими зависимостями и каталогом. Frontend —
Nginx со сборкой React и шаблоном `deploy/nginx.conf.template`. Оба сервиса
работают без root. Vite, TypeScript и тестовые инструменты остаются в стадии
сборки. Backend не содержит UI, Frontend не содержит Backend и ключа OpenAI.

```text
Браузер → localhost:8080 → frontend:8080 (Nginx)
                              └── /api → backend:3001 (Express) → OpenAI
                                                    └── каталог и корзины
```

Только Frontend публикует порт на хосте. `BACKEND_ORIGIN` по умолчанию указывает
на `http://backend:${PORT}` внутри Docker. Nginx передаёт URI и `X-Session-Id`,
обслуживает SPA-маршрут `/cart` и заново разрешает DNS Backend после его
пересоздания. Ошибка соединения с Backend возвращает JSON с HTTP 503 и кодом
`BACKEND_UNAVAILABLE`, чтобы чат показал кнопку повтора. Автоматических повторов
записи на proxy нет.

`/healthz` проверяет Nginx, `/api/health` проходит через proxy до Backend.
Для перезапуска только API: `docker compose restart backend`. Это очищает
демо-сессии; Frontend восстанавливает их при следующем запросе.

Frontend устанавливается через существующий `package-lock.json`, Backend —
через `npm install --package-lock=false`, без изменения lock-файлов. Поскольку
у Backend нет lock-файла, новая сборка может получить более свежие версии
зависимостей в пределах диапазонов `backend/package.json`.

## Размещение на сервере

На сервере с Docker и копией репозитория задайте `.env`, затем выполните ту же
команду `docker compose up --build --wait --remove-orphans`. Порт Frontend публикуется на интерфейсах
хоста. Домен и HTTPS настраиваются в используемом хостинге или reverse proxy;
Frontend обслуживает HTTP. Проверка всего пути — `/api/health`.

Платформа, принимающая готовые образы, может собрать оба из корня:

```sh
docker build -f deploy/Dockerfile --target backend -t ekt-match-backend:release .
docker build -f deploy/Dockerfile --target frontend -t ekt-match-frontend:release .
```

Передайте `PORT`, `APP_MODE` и `OPENAI_API_KEY` только Backend, а `BACKEND_ORIGIN`
с внутренним адресом Backend — Frontend. Имена образов для Compose задаются
через `BACKEND_IMAGE` и `FRONTEND_IMAGE`. Прежний `APP_IMAGE` принимается как
fallback для Backend. Публикация образов, выбор хостинга и
настройка домена выполняются отдельно.

Для обновления кода снова соберите и запустите сервисы. Перед обновлением
можно сохранить текущие образы под отдельными тегами и использовать их для отката
через `BACKEND_IMAGE` и `FRONTEND_IMAGE` с командой `docker compose up --no-build --wait`.

## Состояние приложения

Сессии, история диалога, корзины и кэш OpenAI хранятся в памяти Backend.
Перезапуск или замена Backend очищает их; интерфейс создаёт новую сессию после HTTP 401.
Docker volume не сохраняет это состояние. Используйте один экземпляр приложения
Backend до подключения общего хранилища. Каталог синтетический, оформления настоящего
заказа и резервирования склада нет.

API-ошибка OpenAI не делает Backend нездоровым: локальные запросы продолжают
работать. Healthcheck проверяет готовность самого приложения, а не наличие
ключа или доступность внешних сервисов.

## Проверка

В `live` отправьте «что по товарам есть»: ожидается ответ об ассортименте,
а не требование всех параметров. Затем задайте посторонний вопрос — помощник
должен вернуть разговор к магазину. Для проверки контекста отправьте
«Нужны трёхполюсные автоматы C16 на десять килоампер», затем «восемь штук».
До выбора и подтверждения корзина остаётся пустой.

После запуска откройте интерфейс, отправьте запрос `Нужен автомат 3P C16, 10 kA, 8 штук`, выберите `DEMO-MCB-003`,
подтвердите 8 штук и перейдите в корзину: итог должен быть **63 200 ₸**.
Обновление `/cart` сохраняет корзину до перезапуска контейнера. Два одинаковых
подтверждения с одним `confirmationId` не должны удваивать количество.

Тесты Backend и Frontend запускаются локально командой `npm test` после
`npm run setup`. Тесты OpenAI используют подставные HTTP-ответы и не тратят
API-кредиты. Проверка настоящего запроса требует действующего ключа.

Если AI не отвечает, проверьте `APP_MODE=live` и наличие `OPENAI_API_KEY`,
пересоздайте контейнеры и посмотрите `docker compose logs --tail 50 backend`.
В чате видны ошибки соединения, локальный режим и исчерпание лимита
20 AI-попыток на процесс. Лимит, 768 выходных токенов и таймаут 15 секунд
настраиваются в `backend/config.json`. Ключи и полный `.env` публиковать не нужно.

Формат OpenAI: [Responses API](https://developers.openai.com/api/docs/guides/text),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
Поведение ожидания готовности: [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/).
