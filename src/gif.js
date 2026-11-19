// GIF no próprio app, sem bibliotecas: decodifica (ImageDecoder do Chromium) e codifica GIF animado
// (paleta por "median cut" + LZW). Usado para pôr texto/forma/fundo em cima de um GIF e manter a animação.

// Devolve { frames: [{ bmp: ImageBitmap, delay: ms }], width, height } — quadros já compostos (com o descarte do GIF aplicado)
export async function decodeGif(file, maxFrames = 120) {
  if (typeof ImageDecoder === 'undefined') throw new Error('Este app não consegue ler GIF animado');
  const data = new Uint8Array(await file.arrayBuffer());
  const dec = new ImageDecoder({ data, type: 'image/gif' });
  await dec.tracks.ready;
  const n = dec.tracks.selectedTrack.frameCount;
  const step = Math.max(1, Math.ceil(n / maxFrames)); // GIFs enormes: pula quadros somando o tempo
  const frames = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i, completeFramesOnly: true });
    acc += (image.duration || 100000) / 1000;
    if (i % step === 0) {
      frames.push({ bmp: await createImageBitmap(image), delay: Math.max(20, Math.round(acc)) });
      acc = 0;
    }
    var w = image.displayWidth; var h = image.displayHeight;
    image.close();
  }
  dec.close();
  return { frames, width: w, height: h };
}

function buildPalette(frames, maxColors) {
  let total = 0;
  for (const f of frames) total += f.data.length / 4;
  const stride = Math.max(1, Math.floor(total / 40000));
  const samples = [];
  for (const f of frames) {
    for (let i = 0; i < f.data.length; i += 4 * stride) if (f.data[i + 3] >= 128) samples.push([f.data[i], f.data[i + 1], f.data[i + 2]]);
  }
  if (!samples.length) return [[0, 0, 0]];
  const range = (box) => {
    let mn = [255, 255, 255]; let mx = [0, 0, 0];
    for (const p of box) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; }
    const r = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    const ch = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
    return { ch, span: r[ch] };
  };
  const boxes = [samples];
  while (boxes.length < maxColors) {
    let best = -1; let bestScore = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const sc = range(b).span * Math.sqrt(b.length); if (sc > bestScore) { bestScore = sc; best = i; } });
    if (best < 0) break;
    const box = boxes[best];
    const { ch } = range(box);
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return [Math.round(s[0] / b.length), Math.round(s[1] / b.length), Math.round(s[2] / b.length)];
  });
}

// Compressão LZW do GIF (mesma lógica do omggif)
function lzw(indices, minCode, out) {
  const clear = 1 << minCode; const eoi = clear + 1;
  let codeLen = minCode + 1; let next = eoi + 1;
  let table = new Map();
  let cur = 0; let shift = 0;
  const sub = []; // bytes do fluxo
  const emit = (code) => { cur |= code << shift; shift += codeLen; while (shift >= 8) { sub.push(cur & 255); cur >>>= 8; shift -= 8; } };
  emit(clear);
  let ib = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (ib << 8) | k;
    const hit = table.get(key);
    if (hit === undefined) {
      emit(ib);
      if (next === 4096) { emit(clear); next = eoi + 1; codeLen = minCode + 1; table = new Map(); }
      else { if (next >= (1 << codeLen)) codeLen++; table.set(key, next++); }
      ib = k;
    } else ib = hit;
  }
  emit(ib);
  emit(eoi);
  if (shift > 0) sub.push(cur & 255);
  out.push(minCode);
  for (let i = 0; i < sub.length; i += 255) { const n = Math.min(255, sub.length - i); out.push(n); for (let j = 0; j < n; j++) out.push(sub[i + j]); }
  out.push(0);
}

// frames: [{ data: Uint8ClampedArray RGBA (w*h*4), delay: ms }] → Uint8Array do GIF animado (pixels com alfa < 50% ficam transparentes)
export function encodeGif(frames, w, h) {
  const pal = buildPalette(frames, 255);
  const colors = [[0, 0, 0], ...pal]; // índice 0 = transparente
  while (colors.length < 256) colors.push([0, 0, 0]);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache.get(key);
    if (v !== undefined) return v;
    let best = 1; let bd = 1e9;
    for (let i = 1; i <= pal.length; i++) { const c = colors[i]; const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
    cache.set(key, best);
    return best;
  };
  const out = [];
  const w16 = (n) => out.push(n & 255, (n >> 8) & 255);
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  w16(w); w16(h);
  out.push(0xf7, 0, 0); // tabela global de 256 cores
  for (const c of colors) out.push(c[0], c[1], c[2]);
  out.push(0x21, 0xff, 0x0b, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0); // repetir para sempre
  for (const f of frames) {
    const delay = Math.max(2, Math.round(f.delay / 10));
    out.push(0x21, 0xf9, 0x04, 0x09, delay & 255, (delay >> 8) & 255, 0, 0); // descarte: limpar para o fundo; índice 0 transparente
    out.push(0x2c, 0, 0, 0, 0); w16(w); w16(h); out.push(0);
    const idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < idx.length; p++, i += 4) idx[p] = f.data[i + 3] < 128 ? 0 : nearest(f.data[i], f.data[i + 1], f.data[i + 2]);
    lzw(idx, 8, out);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
