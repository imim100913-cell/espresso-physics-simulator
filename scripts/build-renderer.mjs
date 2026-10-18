import { build } from "esbuild";
await build({
  entryPoints: ["src/render/espresso-scene.js"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "js/renderer.bundle.js",
  minify: true,
  loader: { ".wgsl": "text" },
  legalComments: "eof",
  metafile: true,
}).then(async (result) => {
  const fs = await import("node:fs/promises");
  await fs.copyFile("node_modules/three/LICENSE", "js/renderer.LICENSE.txt");
  await fs.writeFile(
    "js/renderer.build.json",
    JSON.stringify({
      three: "0.186.1",
      bytes: result.metafile.outputs["js/renderer.bundle.js"].bytes,
    }) + "\n",
  );
});
