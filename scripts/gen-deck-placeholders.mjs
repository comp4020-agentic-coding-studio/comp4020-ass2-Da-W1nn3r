import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve("src/decks/assets");
mkdirSync(outDir, { recursive: true });

function box(label) {
  const width = 960;
  const height = 540;
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1c1f26" />
      <rect x="16" y="16" width="${width - 32}" height="${height - 32}"
            fill="none" stroke="#8a8f9c" stroke-width="4" stroke-dasharray="14 10" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif" font-size="34" fill="#c9ccd4">${label}</text>
    </svg>
  `;
}

const targets = [
  { file: "burner-chain.png", label: "PLACEHOLDER — burner chain screenshot" },
  { file: "direct-burner-furnace.png", label: "PLACEHOLDER — direct burner-to-furnace screenshot" },
  { file: "boiler-steam.png", label: "PLACEHOLDER — boiler/steam setup screenshot" },
];

for (const { file, label } of targets) {
  await sharp(Buffer.from(box(label))).png().toFile(resolve(outDir, file));
  console.log(`wrote ${file}`);
}
