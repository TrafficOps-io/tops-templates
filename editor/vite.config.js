import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Reuse the VS Code extension's standalone language model and formatter.
  optimizeDeps: { include: ['tops-templates/src/language.js', 'tops-templates/src/formatter.js'] },
  build: { target: 'es2022', commonjsOptions: { include: [/node_modules/, /vscode-extension\/src\//] } },
});
