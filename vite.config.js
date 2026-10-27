import { defineConfig } from "vite";

// base "./" so the build works from any sub-path (e.g. GitHub Pages /<repo>/)
export default defineConfig({ base: "./" });
