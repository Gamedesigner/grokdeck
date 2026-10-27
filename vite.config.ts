import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const viewerCompatibility={name:'disable-webcodecs',transform(code:string,id:string){if(id.endsWith('/lib/util/browser.js'))return code.replace('await _checkWebCodecsH264DecodeSupport()', 'false');}};
export default defineConfig({
  plugins: [react(),viewerCompatibility],
  optimizeDeps:{rolldownOptions:{plugins:[viewerCompatibility]}},
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
