import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Keep the HTML entry relative to the project root. Vite 8/Rolldown can
    // otherwise derive an invalid emitted asset name from this Windows path.
    rollupOptions: {
      input: "index.html",
    },
  },
});
