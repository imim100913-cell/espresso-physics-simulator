# Generated artwork

Created with the image generation tool on 2026-10-19 for Espresso Lab. These are illustrative assets for the simulator, not photographs of a particular manufacturer's product. There are no external stock-image or CAD dependencies.

| File | Native dimensions | Contents | Encoded bytes |
| --- | --- | --- | --- |
| `barista-tools.webp` | 1774 × 887 | Transparent scale + empty dish, grinder, cutaway portafilter, tamper, WDT tool, espresso machine, empty glass cup, scoop | 354158 |
| `coffee-materials.webp` | 2172 × 724 | Isolated bean, dry-ground texture, crema texture | 542728 |
| `atelier.webp` | 1536 × 1024 | Empty walnut worktop and softly lit, defocused green atelier | 63968 |

Art direction: photographic materials, polished machined metal, walnut, forest-green enamel, warm softbox lighting with a cool edge light. Equipment contains no baked-in digital measurements. All measured text is rendered by the application.

Generated PNG originals remain in `/workspace/generated_images/`. WebP files use format compression only: no pixel crops, compositing, retouching or resizing. The application selects regions of the intact atlases through SVG viewports and masks at runtime. Source regions and animation anchors are declared in `js/brew-artwork.js`.

Generation references:

- Tools: `exec-f75266ca-bcd4-4726-93d4-86ecb517168b.png`
- Backdrop: `exec-4b775b01-0db6-4a7c-9bae-9fc83d533e1e.png`
- Materials: `exec-7ce49c5f-a3e6-4a0e-9c9a-72502f29486f.png`

Do not use the image textures as physical solver data. Animation timing, dose, pressure, temperature, flow and cup mass come from the shared workflow and shot samples.
