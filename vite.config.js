import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/ethers/') || id.includes('node_modules/@noble/') || id.includes('node_modules/@adraffy/') || id.includes('node_modules/aes-js/')) return 'evm';
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) return 'react';
        },
      },
    },
  },
});
