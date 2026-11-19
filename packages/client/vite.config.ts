import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logFilePath = path.resolve(__dirname, 'client.log');

function clientLoggerPlugin(): Plugin {
  return {
    name: 'client-logger',
    configureServer(server) {
      server.middlewares.use('/__client_log', (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const line = `[${new Date().toISOString()}] [CLIENT ${data.type?.toUpperCase() ?? 'LOG'}] ${data.text ?? body}\n`;
            console.log(line.trim());
            fs.appendFileSync(logFilePath, line, 'utf-8');
          } catch {
            const line = `[${new Date().toISOString()}] [CLIENT LOG] ${body}\n`;
            console.log(line.trim());
            fs.appendFileSync(logFilePath, line, 'utf-8');
          }
          res.statusCode = 200;
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), clientLoggerPlugin()],
  build: {
    // The tactical viewport pulls in all of Pixi v8. Isolate the vendor
    // payloads from app code so game-logic edits don't invalidate the
    // renderer chunks in players' caches (and vice versa).
    // NOTE: the ~2MB main chunk is intentional — the offline-ready SRD 5.1
    // dataset (~1MB JSON: classes, spells, monsters, Kaelen module) plus the
    // deterministic engine must ship with the app (no network at runtime).
    chunkSizeWarningLimit: 2300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js')) return 'pixi-vendor';
          if (
            id.includes('node_modules/react-dom') ||
            (id.includes('node_modules/react/') && !id.includes('node_modules/react-')) ||
            id.includes('node_modules/scheduler')
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.{idea,git,cache,output,temp}/**'],
  },
});
