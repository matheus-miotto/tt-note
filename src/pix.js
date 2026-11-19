// Pix "copia e cola" (BR Code estático) e QR Code em SVG. Sem DOM: serve ao app (support.js) e ao gerador do README (tools/pix-qr.mjs).
import qrcode from 'qrcode-generator';

const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const ascii = (s, n) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, n);
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
export function pixPayload(key, name, city) {
  const p = tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', key)) + tlv('52', '0000') + tlv('53', '986') + tlv('58', 'BR')
    + tlv('59', ascii(name, 25) || 'TT NOTE') + tlv('60', ascii(city, 15) || 'BRASIL') + tlv('62', tlv('05', '***')) + '6304';
  return p + crc16(p);
}

// QR Code (preto sobre branco, com a margem exigida pelos leitores) como texto SVG
export function qrSvg(text, px = 220) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  const s = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
