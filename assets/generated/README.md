# Generated artwork

Created with the image generation tool on 2026-10-19 for Espresso Lab. These are illustrative assets for the simulator, not photographs of a particular manufacturer's product. There are no external stock-image or CAD dependencies.

| File                    | Native dimensions | Contents                                                                                                                 | Encoded bytes |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `barista-tools.webp`    | 1774 × 887        | Transparent scale + empty dish, grinder, cutaway portafilter, tamper, WDT tool, espresso machine, empty glass cup, scoop | 354158        |
| `coffee-materials.webp` | 2172 × 724        | Isolated bean, dry-ground texture, crema texture                                                                         | 542728        |
| `atelier.webp`          | 1536 × 1024       | Empty walnut worktop and softly lit, defocused green atelier                                                             | 63968         |
| `barista-hands.webp`    | 1536 × 1024       | Four physically held tools: scoop, WDT, tamper, portafilter grip                                                         | 134986        |

Art direction: photographic materials, polished machined metal, walnut, forest-green enamel, warm softbox lighting with a cool edge light. Equipment contains no baked-in digital measurements. All measured text is rendered by the application.

Generated PNG originals remain in `/workspace/generated_images/`. WebP encoding uses format compression only. The hands were generated from the tool reference and their transparent background was refined with the image generation tool. The application selects regions of the intact atlases through SVG viewports and masks at runtime. Source regions are declared in `js/brew-artwork.js`; support contacts and scene proportions are declared in `js/brew-layout.js`.

Generation references:

- Tools: `exec-f75266ca-bcd4-4726-93d4-86ecb517168b.png`
- Backdrop: `exec-4b775b01-0db6-4a7c-9bae-9fc83d533e1e.png`
- Materials: `exec-7ce49c5f-a3e6-4a0e-9c9a-72502f29486f.png`
- Hands: `exec-1fa3e697-8811-4135-bdfc-9920a89ce573.png`, refined as `exec-8ccdf6f7-cf69-45fd-8e73-49a50208053a.png`

Do not use the image textures as physical solver data. Animation timing, dose, pressure, temperature, flow and cup mass come from the shared workflow and shot samples.
