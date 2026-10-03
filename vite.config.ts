import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "renderer", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/work/**", "**/dist/**", "**/outputs/**"] },
  },
});
