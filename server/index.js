import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { memoryStore, mongoStore } from './store.js';
import { createApp } from './app.js';

dotenv.config({
  path: fileURLToPath(
    new URL('../.env', import.meta.url)
  ),
  quiet: true
});

const config = {
  demo: process.env.DEMO_MODE === 'true',
  jwtSecret: process.env.JWT_SECRET,
  production: process.env.NODE_ENV === 'production',

  port: Number(
    process.env.PORT || 3001
  ),

  geminiKey:
    process.env.GEMINI_API_KEY,

  geminiModel:
    process.env.GEMINI_MODEL ||
    'gemini-3.6-flash',

  sttModel:
    process.env.STT_MODEL ||
    'gemini-3.5-transcribe',

  // Compatibility for existing mic-enable logic
  sttKey:
    process.env.GEMINI_API_KEY
};

if (!config.demo && !process.env.MONGODB_URI) {
  throw new Error(
    'Set MONGODB_URI or copy .env.example to .env for demo mode.'
  );
}

const store = config.demo
  ? memoryStore()
  : await mongoStore(
      process.env.MONGODB_URI,
      process.env.MONGODB_DB || 'stockvoice'
    );

const app = createApp(store, config);

const dist = fileURLToPath(
  new URL('../dist', import.meta.url)
);

if (existsSync(dist)) {
  app.use(express.static(dist));

  app.get('/{*path}', (req, res) =>
    res.sendFile(
      path.join(dist, 'index.html')
    )
  );
}

const host =
  process.env.HOST || '127.0.0.1';

const server = app.listen(
  config.port,
  host,
  async error => {
    if (error) {
      console.error(
        error.code === 'EADDRINUSE'
          ? `Port ${config.port} is already occupied. Stop the other StockVoice backend and restart this project.`
          : `Server could not start: ${error.code || error.name}`
      );

      await store.close();
      process.exit(1);
    }

    console.log(
      `StockVoice running at http://${host}:${config.port} ${
        config.demo
          ? '(DEMO — in-memory data)'
          : '(LIVE — MongoDB)'
      }`
    );
  }
);

for (const signal of [
  'SIGINT',
  'SIGTERM'
]) {
  process.on(signal, () =>
    server.close(async () => {
      await store.close();
      process.exit(0);
    })
  );
}