# OfficeGhost

Единый репозиторий OfficeGhost: маркетинговый сайт и desktop-приложение для локального поиска, общения и работы с документами.

## Сайт

```bash
npm install
npm run dev
```

## Проверка production-сборки

```bash
npm run build
```

Сайт разворачивается как Next.js-проект в Vercel и использует домены `officeghost.com` и `www.officeghost.com`.

## Desktop-приложение

Новый клиент находится в `desktop/` и использует React, TypeScript, Vite и Tauri 2. Rust-ядро отвечает за индексирование, локальный поиск, Ollama и создание файлов.

```bash
cd desktop
npm install
npm run dev
```

Production-сборка интерфейса проверяется командой `npm run build`. Для запуска и упаковки нативного приложения также требуется установленный Rust toolchain.
