/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const repoName =
  process.env.GITHUB_ACTIONS === "true"
    ? process.env.GITHUB_REPOSITORY?.split("/")[1] ?? ""
    : "";

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      nodePolyfills({
        include: ["buffer"],
        globals: {
          Buffer: true,
        },
      }),
      wasm(),
    ],
    base:
      process.env.GITHUB_ACTIONS === "true" && repoName
        ? `/${repoName}/`
        : "/",
    build: {
      target: "esnext",
    },
    optimizeDeps: {
      exclude: ["@stellar/stellar-xdr-json"],
    },
    define: {
      global: "window",
    },
    envPrefix: "PUBLIC_",
    server: {
      proxy: {
        "/friendbot": {
          target: "http://localhost:8000/friendbot",
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./vitest.setup.ts",
    },
  };
});
