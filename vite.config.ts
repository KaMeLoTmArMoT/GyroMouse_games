import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        marble_maze: resolve(__dirname, 'games/marble_maze/index.html'),
        subway_runner: resolve(__dirname, 'games/subway_runner/index.html'),
        crane_tower: resolve(__dirname, 'games/crane_tower/index.html'),
        artillery_siege: resolve(__dirname, 'games/artillery_siege/index.html'),
        cyber_pong: resolve(__dirname, 'games/cyber_pong/index.html')
      }
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
});
