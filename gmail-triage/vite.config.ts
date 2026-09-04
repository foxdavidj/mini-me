import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [tanstackStart(), nitro({ preset: "bun" }), react()],
  server: { host: "127.0.0.1", port: 8766 },
});
