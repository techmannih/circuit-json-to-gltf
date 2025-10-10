import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["lib/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  noExternal: ["@jscad/modeling"],
})
