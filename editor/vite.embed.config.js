import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react(), tailwindcss(), { name: 'editor-message-keys', generateBundle() { this.emitFile({ type: 'asset', fileName: 'messages.json', source: JSON.stringify(Object.keys(JSON.parse(readFileSync(new URL('../packages/template-editor-shell/src/studio-translations.json', import.meta.url), 'utf8'))).sort()) }); } }],
  worker: { format: 'es' },
  build: {
    outDir: 'embedded/dist', emptyOutDir: true, target: 'es2022',
    lib: { entry: 'src/HostedEditor.jsx', formats: ['es'], fileName: () => 'editor.js', cssFileName: 'editor' },
    commonjsOptions: { include: [/node_modules/, /packages\/template-language\/src\//] },
  },
});
