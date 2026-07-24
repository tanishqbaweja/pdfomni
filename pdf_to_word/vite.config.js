import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const devSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  base: '/pdf-to-word/app/',
  define: {
    __PDFOMNI_DEV_SESSION__: JSON.stringify(devSessionId)
  },
  plugins: [{
    name: 'pdfomni-dev-session',
    configureServer(server) {
      server.middlewares.use('/__pdfomni_dev_session', (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(devSessionId);
      });

      // An existing tab can reconnect after `npm run dev` is restarted while
      // retaining the converter module from the previous server process.
      // Ask reconnected Vite clients to load the current module graph.
      server.httpServer?.once('listening', () => {
        setTimeout(() => server.ws.send({ type: 'full-reload', path: '*' }), 750);
        setTimeout(() => server.ws.send({ type: 'full-reload', path: '*' }), 2500);
      });
    }
  }],
  server: {
    port: 8082,
    host: true,
    open: false,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store'
    }
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'docx', 'jszip']
  },
  build: {
    outDir: path.resolve(projectRoot, mode === 'protected'
      ? '../obfuscated_dist/pdf-to-word/app'
      : '../dist/pdf-to-word/app'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('pdfjs-dist')) return 'pdfjs-dist';
          if (normalized.includes('/docx/')) return 'docx';
          if (normalized.includes('/jszip/')) return 'jszip';
          if (normalized.includes('node_modules')) return 'vendor';
          return undefined;
        }
      }
    }
  }
}));
