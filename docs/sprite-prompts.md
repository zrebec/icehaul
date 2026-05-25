# Sprite prompts for AI image generation

Use these prompts with ChatGPT (DALL-E) or similar AI image generators.
After generation, manually convert the result to a zx-kit `createBitmap` byte array.

## Constraints for ALL sprites

Every prompt should include this preamble:

> ZX Spectrum 8-bit pixel art. Strict constraints:
> - Only these colours: black (#000), blue (#0000CD), red (#CD0000), magenta (#CD00CD), green (#00CD00), cyan (#00CDCD), yellow (#CDCD00), white (#CDCDCD), and their bright variants.
> - Maximum 2 colours per 8×8 pixel cell (ink + paper) — this is "colour clash."
> - No anti-aliasing, no gradients, no transparency. Each pixel is exactly one colour.
> - Dark background (black paper) for most cells.
> - Show the result as a zoomed pixel grid so I can read individual pixels.

---

## 1. Truck — rear view (16×32 px)

> [preamble above]
> Draw a rear view of a heavy ice-road truck, 16 pixels wide × 32 pixels tall.
> Top section: cab roof narrowing upward (white outline on black).
> Second section: cab body with a small rear window glowing cyan (instrument light reflection).
> Third section: rectangular trailer body (white outline, dark interior).
> Bottom section: two red taillights at the corners, two dark wheel pairs.
> The truck should look boxy, industrial, heavy — like a Peterbilt or Kenworth.
> Colour assignment per 8×8 cell row:
> - Row 0 (cab roof): ink=bright white, paper=black
> - Row 1 (cab+window): ink=bright cyan, paper=black
> - Row 2 (trailer): ink=bright white, paper=black
> - Row 3 (wheels+lights): ink=bright red, paper=black

## 2. Fuel canister (8×8 px)

> [preamble above]
> Draw a small fuel jerrycan, 8×8 pixels. Viewed from the side, slightly angled.
> Red body (bright red ink), yellow cap/handle at top (bright yellow).
> Should be instantly recognisable as "fuel" even at tiny size.
> Single 8×8 cell: ink=bright red, paper=black. Yellow cap drawn as 1-2 pixels.

## 3. Warning sign — ice (8×16 px, 1×2 cells)

> [preamble above]
> Draw a diamond-shaped warning road sign, 8 pixels wide × 16 pixels tall.
> Top cell: yellow diamond with a black snowflake or "!" symbol inside.
> Bottom cell: thin white post/pole on black background.
> Cell 0: ink=bright yellow, paper=black. Cell 1: ink=bright white, paper=black.

## 4. Fallen tree obstacle (24×8 px, 3×1 cells)

> [preamble above]
> Draw a fallen tree trunk lying across the road, 24 pixels wide × 8 pixels tall.
> Dark green trunk with lighter green branch stubs.
> Left cell: ink=green, paper=black. Middle cell: ink=bright green, paper=black. Right: ink=green, paper=black.

## 5. Boulder obstacle (16×16 px, 2×2 cells)

> [preamble above]
> Draw a large rock/boulder on the road, 16×16 pixels. Viewed from slightly above.
> Grey/white body with darker shadow on one side.
> All 4 cells: ink=bright white, paper=black. Use varying pixel density for shadow effect.

## 6. Dashboard hood/bonnet (256×16 px)

> [preamble above]
> Draw the top edge of a truck dashboard/bonnet as seen from the driver's seat,
> 256 pixels wide × 16 pixels tall. Mostly black with a thin bright white or
> cyan outline along the top edge suggesting the dashboard curve.
> The centre should dip slightly (windscreen A-pillar gap).
> This sits at the bottom of the driving viewport, above the instrument panel.
