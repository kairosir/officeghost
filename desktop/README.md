# OfficeGhost Desktop

Desktop-клиент OfficeGhost на React, TypeScript и Tauri 2.

## Возможности текущей версии

- чат по локальному индексу документов;
- источники для каждого ответа;
- поиск по PDF, DOCX, XLSX, TXT и Markdown;
- обновление индекса;
- создание файлов из ответа;
- фоновые сценарии и глобальный шорткат;
- локальная модель через Ollama.

## Запуск интерфейса

```bash
npm install
npm run dev
```

## Нативный запуск

После установки Rust:

```bash
npm run tauri:dev
```

## Проверка

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path rust-indexer/Cargo.toml
```
