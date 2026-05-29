/// <reference types="vitest/config" />

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const host = env.TAURI_DEV_HOST;

const packageJson = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function getNodeModulePackageName(id: string) {
  const normalizedId = id.replaceAll("\\", "/").split(/[?#]/, 1)[0] ?? "";
  const packagePath = normalizedId.split(/node_modules\//).at(-1) ?? "";
  if (packagePath.startsWith("@")) {
    const [scope, name] = packagePath.split("/");
    return scope && name ? `${scope}/${name}` : packagePath;
  }
  return packagePath.split("/")[0] ?? packagePath;
}

function getVendorChunkName(id: string) {
  const packageName = getNodeModulePackageName(id);

  if (packageName.startsWith("@xterm/")) return "vendor-terminal";
  if (packageName.startsWith("@tauri-apps/")) return "vendor-tauri";
  if (packageName === "lucide-react") return "vendor-icons";
  if (packageName.startsWith("@dnd-kit/")) return "vendor-dnd";
  if (
    packageName.startsWith("@radix-ui/") ||
    packageName === "radix-ui" ||
    packageName.startsWith("@floating-ui/") ||
    packageName === "aria-hidden" ||
    packageName === "react-remove-scroll" ||
    packageName === "react-remove-scroll-bar" ||
    packageName === "react-style-singleton" ||
    packageName === "use-callback-ref" ||
    packageName === "use-sidecar" ||
    packageName === "get-nonce"
  ) {
    return "vendor-radix";
  }
  if (
    packageName === "motion" ||
    packageName === "framer-motion" ||
    packageName === "motion-dom" ||
    packageName === "motion-utils"
  ) {
    return "vendor-motion";
  }
  if (
    packageName === "react" ||
    packageName === "react-dom" ||
    packageName === "react-router" ||
    packageName === "scheduler" ||
    packageName === "use-sync-external-store" ||
    packageName === "next-themes" ||
    packageName === "zustand" ||
    packageName === "sonner" ||
    packageName === "class-variance-authority" ||
    packageName === "clsx" ||
    packageName === "tailwind-merge"
  ) {
    return "vendor-react";
  }

  return "vendor";
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    sourcemap: "hidden" as const,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          return getVendorChunkName(id);
        },
      },
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
