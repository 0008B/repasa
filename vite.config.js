import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import netlify from "@netlify/vite-plugin";

// Das Netlify-Vite-Plugin sorgt dafuer, dass "npm run dev" lokal auch
// Zugriff auf Netlify Blobs hat (sonst nur "netlify dev" moeglich).
export default defineConfig({
  plugins: [react(), netlify()],
});
