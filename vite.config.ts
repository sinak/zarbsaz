import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { ZarbSazStore } from './server/db';
import { createApiMiddleware } from './server/api';

const WORKSPACE_ROOT = __dirname;
const DB_PATH = path.join(WORKSPACE_ROOT, 'data', 'zarbsaz.sqlite');

function zarbSazApiPlugin(): Plugin {
  let store: ZarbSazStore | null = null;
  return {
    name: 'zarbsaz-api',
    configureServer(server) {
      store = new ZarbSazStore(DB_PATH);
      server.middlewares.use(createApiMiddleware(WORKSPACE_ROOT, store));
      server.httpServer?.once('close', () => {
        store?.close();
        store = null;
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), zarbSazApiPlugin()],
  build: {
    target: 'esnext',
  },
});
