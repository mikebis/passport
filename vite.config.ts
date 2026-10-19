import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function localData(): Plugin {
  const directory = resolve('data');
  return {
    name: 'local-data',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const { pathname: path, searchParams } = new URL(request.url || '/', 'http://localhost');
        if (searchParams.has('import')) return next();
        const filename = readdirSync(directory).find((name) => path === `/data/${name}`);
        if (!filename) return next();
        response.setHeader('Content-Type', filename.endsWith('.json') ? 'application/json' : 'text/plain');
        response.end(readFileSync(resolve(directory, filename)));
      });
    },
    generateBundle() {
      for (const filename of readdirSync(directory)) {
        this.emitFile({
          type: 'asset',
          fileName: `data/${filename}`,
          source: readFileSync(resolve(directory, filename)),
        });
      }
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [localData()],
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.{ts,mjs}'] },
});
