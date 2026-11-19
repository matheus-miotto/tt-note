// Gera docs/pix-qr.svg (QR Code do Pix do README) a partir do support.config.json. Rode: npm run pix:qr
import fs from 'fs';
import { pixPayload, qrSvg } from '../src/pix.js';
const cfg = JSON.parse(fs.readFileSync(new URL('../support.config.json', import.meta.url), 'utf8'));
if (!cfg.pix) { console.error('Sem "pix" em support.config.json'); process.exit(1); }
const payload = pixPayload(cfg.pix, cfg.pixName, cfg.pixCity);
fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../docs/pix-qr.svg', import.meta.url), qrSvg(payload, 240));
fs.writeFileSync(new URL('../docs/pix-copia-e-cola.txt', import.meta.url), payload + '\n');
console.log('docs/pix-qr.svg e docs/pix-copia-e-cola.txt gerados');
