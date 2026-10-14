import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const inputDir = path.resolve(process.argv[2]);
const outputDir = path.resolve(process.argv[3]);
const columns = 4;
const rows = 4;
const tileWidth = 500;
const tileHeight = 500;
const labelHeight = 38;
const files = (await readdir(inputDir))
  .filter(name => /\.(?:jpe?g|png|webp)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

await mkdir(outputDir, { recursive: true });
for (let start = 0; start < files.length; start += columns * rows) {
  const page = files.slice(start, start + columns * rows);
  const composites = [];
  for (let index = 0; index < page.length; index += 1) {
    const name = page[index];
    const image = await sharp(path.join(inputDir, name))
      .rotate()
      .resize(tileWidth, tileHeight - labelHeight, { fit: 'contain', background: '#f5f5f5', withoutEnlargement: true })
      .flatten({ background: '#f5f5f5' })
      .jpeg({ quality: 88 })
      .toBuffer();
    const label = Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111827"/><text x="12" y="26" font-family="Arial" font-size="22" fill="white">${name.replaceAll('&', '&amp;')}</text></svg>`);
    const tile = await sharp({ create: { width: tileWidth, height: tileHeight, channels: 3, background: '#ffffff' } })
      .composite([{ input: label, top: 0, left: 0 }, { input: image, top: labelHeight, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
    composites.push({ input: tile, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * tileHeight });
  }
  const pageNumber = String(Math.floor(start / (columns * rows)) + 1).padStart(2, '0');
  await sharp({ create: { width: columns * tileWidth, height: rows * tileHeight, channels: 3, background: '#d1d5db' } })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(path.join(outputDir, `sheet-${pageNumber}.jpg`));
}

process.stdout.write(`${JSON.stringify({ files: files.length, sheets: Math.ceil(files.length / (columns * rows)), outputDir }, null, 2)}\n`);
