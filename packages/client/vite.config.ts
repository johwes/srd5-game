import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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
            console.log(`[CLIENT ${data.type?.toUpperCase() ?? 'LOG'}]`, data.text ?? body);
          } catch {
            console.log('[CLIENT LOG]', body);
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
  },
});
