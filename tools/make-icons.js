// Gera os ícones a partir de assets/logo.png:
//  1) recorta a área escura ao redor da marca (para o logo aparecer maior)
//  2) assets/logo-crop.png, logo-128.png, about.png, icon.png e icon.ico
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');

const PAD = 0.1; // respiro ao redor da marca, em fração do tamanho

async function crop() {
  const src = sharp('assets/logo.png');
  const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
  const bg = { r: data[0], g: data[1], b: data[2] }; // cor do canto = fundo
  const trimmed = await src.clone().trim({ background: bg, threshold: 40 }).png().toBuffer({ resolveWithObject: true });
  const side = Math.max(trimmed.info.width, trimmed.info.height);
  const total = Math.round(side * (1 + PAD * 2));
  const left = Math.floor((total - trimmed.info.width) / 2);
  const top = Math.floor((total - trimmed.info.height) / 2);
  return sharp({ create: { width: total, height: total, channels: 3, background: bg } })
    .composite([{ input: trimmed.data, left, top }])
    .png().toBuffer();
}

const rounded = (buf, size, ratio = 0.18) => {
  const r = Math.round(size * ratio);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
  return sharp(buf).resize(size, size).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
};

(async () => {
  const c = await crop();
  fs.writeFileSync('assets/logo-crop.png', await sharp(c).resize(512, 512).png().toBuffer());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync('assets/icon.ico', await pngToIco(await Promise.all(sizes.map((s) => rounded(c, s)))));
  fs.writeFileSync('assets/icon.png', await rounded(c, 256));
  fs.writeFileSync('assets/logo-128.png', await rounded(c, 128));
  fs.writeFileSync('assets/about.png', await rounded(c, 128));
  console.log('ok');
})();
