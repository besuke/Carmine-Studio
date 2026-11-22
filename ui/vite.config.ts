/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

// The R API (server/server.R) listens on 127.0.0.1:8787. The page calls /api/* on its own origin,
// and Vite forwards it, in `npm run dev` and `npm run preview` alike.
const apiTarget = process.env.LFL_API_URL ?? "http://127.0.0.1:8787";
const proxy = { "/api": { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkMath, [remarkGfm, { singleTilde: false }]], rehypePlugins: [rehypeKatex] }) },
    react({ include: /\.(mdx|tsx|ts)$/ }),
  ],
  server: { host: "127.0.0.1", port: 8081, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true, proxy },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
