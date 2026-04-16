import { readFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', 'apps', 'web', 'public');
const svgPath = resolve(root, 'icons', 'fc26-companion.svg');
const svgBuffer = readFileSync(svgPath);

// sharp lives in the root pnpm store — resolve it manually
const sharpPath = resolve(__dirname, '..', 'node_modules', '.pnpm', 'sharp@0.33.5', 'node_modules', 'sharp');
const sharp = (await import(`file:///${sharpPath.replace(/\\/g, '/')}/lib/index.js`)).default;

const sizes = [
  { name: 'favicon-32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

for (const { name, size } of sizes) {
  const density = Math.max(72, Math.round((72 * size) / 512) * 3);
  await sharp(svgBuffer, { density })
    .resize(size, size)
    .png()
    .toFile(resolve(root, name));
  console.log(`✓ ${name} (${size}x${size})`);
}

// Copy SVG as favicon.svg
copyFileSync(svgPath, resolve(root, 'favicon.svg'));
console.log('✓ favicon.svg (copy)');
