import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    modulePreload: false,
    chunkSizeWarningLimit: 900,
    target: "es2022",
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
