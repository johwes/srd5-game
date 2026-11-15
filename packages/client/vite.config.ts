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
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.{idea,git,cache,output,temp}/**'],
  },
});
