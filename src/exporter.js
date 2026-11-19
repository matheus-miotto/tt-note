// Exportar uma guia Markdown para Word (.docx) sem bibliotecas: converte os blocos do Markdown em WordprocessingML
// (títulos, listas, tarefas, citações, código, tabelas, links, negrito/itálico, IMAGENS) e empacota num .zip (formato do .docx).
import { marked } from 'marked';

/* ───── zip mínimo (sem compressão; o Word abre normalmente) ───── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const te = new TextEncoder();
export function zip(files) { // files: [{ name, data: Uint8Array }]
  const parts = []; const central = []; let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = te.encode(f.name); const crc = crc32(f.data);
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, f.data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

/* ───── utilidades ───── */
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const MAX_W = 5760000; // ~16 cm em EMU
const MAX_H = 8000000; // ~22 cm

/* ───── conversão ───── */
// md: texto Markdown já com os [[wikilinks]] trocados por texto; resolveImage(href, alt) -> { bytes, ext, w, h } | null
export async function buildDocx(md, resolveImage) {
  const tokens = marked.lexer(md);
  const images = new Map(); // href -> { rid, name, ext, bytes, cx, cy }
  const links = new Map(); // href -> rid
  const files = [];
  let nextRid = 10; let nextDoc = 1;

  const hrefs = [];
  marked.walkTokens(tokens, (t) => { if (t.type === 'image' && !hrefs.includes(t.href)) hrefs.push(t.href); });
  for (const h of hrefs) {
    let r = null;
    try { r = await resolveImage(h); } catch { r = null; }
    if (r && r.bytes && r.w > 0 && r.h > 0) {
      let cx = Math.round(r.w * 9525); let cy = Math.round(r.h * 9525);
      const k = Math.min(1, MAX_W / cx, MAX_H / cy); cx = Math.max(9525, Math.round(cx * k)); cy = Math.max(9525, Math.round(cy * k));
      const n = images.size + 1;
      images.set(h, { rid: 'rId' + nextRid++, name: `image${n}.${r.ext}`, ext: r.ext, bytes: r.bytes, cx, cy });
    }
  }

  const run = (text, f = {}) => {
    if (!text) return '';
    let pr = '';
    if (f.link) pr += '<w:rStyle w:val="Hyperlink"/>';
    if (f.code) pr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    if (f.b) pr += '<w:b/>';
    if (f.i) pr += '<w:i/>';
    if (f.s) pr += '<w:strike/>';
    if (f.code) pr += '<w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>';
    if (f.size) pr += `<w:sz w:val="${f.size}"/>`;
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  };
  const picture = (img, alt) => {
    const id = nextDoc++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${img.cx}" cy="${img.cy}"/><wp:docPr id="${id}" name="Imagem ${id}" descr="${xml(alt || '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${img.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${img.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${img.cx}" cy="${img.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const inline = (toks, f = {}) => {
    let out = '';
    for (const t of toks || []) {
      switch (t.type) {
        case 'text': out += t.tokens && t.tokens.length ? inline(t.tokens, f) : run(unesc(t.text).replace(/\n/g, ' '), f); break;
        case 'escape': out += run(unesc(t.text), f); break;
        case 'strong': out += inline(t.tokens, { ...f, b: true }); break;
        case 'em': out += inline(t.tokens, { ...f, i: true }); break;
        case 'del': out += inline(t.tokens, { ...f, s: true }); break;
        case 'codespan': out += run(unesc(t.text), { ...f, code: true }); break;
        case 'br': out += '<w:r><w:br/></w:r>'; break;
        case 'link': {
          if (!/^(https?:|mailto:)/i.test(t.href)) { out += inline(t.tokens, f); break; }
          if (!links.has(t.href)) links.set(t.href, 'rId' + nextRid++);
          out += `<w:hyperlink r:id="${links.get(t.href)}">${inline(t.tokens, { ...f, link: true })}</w:hyperlink>`;
          break;
        }
        case 'image': {
          const img = images.get(t.href);
          out += img ? picture(img, t.text) : run(`[imagem: ${unesc(t.text) || t.href}]`, { ...f, i: true });
          break;
        }
        case 'html': { const txt = unesc(String(t.text || t.raw).replace(/<[^>]*>/g, '')); out += run(txt, f); break; }
        default: if (t.text) out += run(unesc(t.text), f);
      }
    }
    return out;
  };

  const para = (runs, o = {}) => {
    let pr = '';
    if (o.style) pr += `<w:pStyle w:val="${o.style}"/>`;
    if (o.keepNext) pr += '<w:keepNext/>';
    if (o.border) pr += `<w:pBdr>${o.border}</w:pBdr>`;
    if (o.shade) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`;
    if (o.spacing) pr += `<w:spacing w:before="${o.spacing[0]}" w:after="${o.spacing[1]}"${o.line ? ` w:line="${o.line}" w:lineRule="auto"` : ''}/>`;
    if (o.left != null) pr += `<w:ind w:left="${o.left}"${o.hanging ? ` w:hanging="${o.hanging}"` : ''}/>`;
    if (o.jc) pr += `<w:jc w:val="${o.jc}"/>`;
    return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${runs}</w:p>`;
  };

  const blocks = (toks, level = 0, quote = false) => {
    let out = '';
    for (const t of toks) {
      switch (t.type) {
        case 'space': break;
        case 'heading': out += para(inline(t.tokens), { style: 'Heading' + Math.min(6, t.depth), keepNext: true }); break;
        case 'paragraph': out += para(inline(t.tokens), { left: quote ? 360 + level * 360 : level ? level * 360 : undefined, border: quote ? '<w:left w:val="single" w:sz="18" w:space="8" w:color="A6A6A6"/>' : undefined, spacing: [0, 120] }); break;
        case 'text': out += para(inline(t.tokens || [t]), { left: level ? level * 360 : undefined, spacing: [0, 60] }); break;
        case 'code': {
          const lines = String(t.text).replace(/\t/g, '    ').split('\n');
          lines.forEach((ln, i) => { out += para(ln ? run(ln, { code: false, size: 19 }).replace('<w:rPr>', '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>') : '', { shade: 'F2F2F2', spacing: [i === 0 ? 60 : 0, i === lines.length - 1 ? 160 : 0], left: level * 360 || undefined }); });
          break;
        }
        case 'blockquote': out += blocks(t.tokens, level, true); break;
        case 'hr': out += para('', { border: '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/>', spacing: [120, 120] }); break;
        case 'list': {
          t.items.forEach((it, i) => {
            const bullet = it.task ? (it.checked ? '☑ ' : '☐ ') : t.ordered ? `${(Number(t.start) || 1) + i}. ` : '• ';
            const left = 360 * (level + 1);
            let first = true;
            for (const b of it.tokens) {
              if (b.type === 'list') { out += blocks([b], level + 1, quote); continue; }
              if (b.type === 'text' || b.type === 'paragraph') {
                out += para(run(first ? bullet : '') + inline(b.tokens || [b]), { left, hanging: first ? 300 : 0, spacing: [0, 60] });
                first = false;
              } else if (b.type === 'space') continue;
              else { out += blocks([b], level + 1, quote); }
            }
            if (first) out += para(run(bullet), { left, hanging: 300, spacing: [0, 60] });
          });
          if (level === 0) out += para('', { spacing: [0, 60] });
          break;
        }
        case 'table': {
          const cols = Math.max(1, t.header.length); const w = Math.floor(9000 / cols);
          const cell = (c, head, al) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : ''}</w:tcPr>${para(inline(c.tokens, head ? { b: true } : {}), { spacing: [40, 40], jc: al === 'center' ? 'center' : al === 'right' ? 'right' : undefined })}</w:tc>`;
          const row = (cells, head) => `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c, i) => cell(c, head, t.align && t.align[i])).join('')}</w:tr>`;
          out += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array(cols).fill(`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${row(t.header, true)}${t.rows.map((r) => row(r, false)).join('')}</w:tbl>${para('', { spacing: [0, 120] })}`;
          break;
        }
        case 'html': { const txt = unesc(String(t.text || t.raw).replace(/<[^>]*>/g, '')).trim(); if (txt) out += para(run(txt), { spacing: [0, 120] }); break; }
        default: if (t.text) out += para(run(unesc(t.text)), { spacing: [0, 120] });
      }
    }
    return out;
  };

  const body = blocks(tokens) || para('');
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const heading = (n, sz, color) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 40, '1F3864')}${heading(2, 32, '2F5496')}${heading(3, 28, '2F5496')}${heading(4, 24, '1F3864')}${heading(5, 22, '1F3864')}${heading(6, 22, '595959')}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;
  const ext = [...new Set([...images.values()].map((i) => i.ext))];
  const mime = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${ext.map((e) => `<Default Extension="${e}" ContentType="${mime[e]}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${[...images.values()].map((i) => `<Relationship Id="${i.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${i.name}"/>`).join('')}${[...links].map(([h, rid]) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(h)}" TargetMode="External"/>`).join('')}</Relationships>`;
  files.push({ name: '[Content_Types].xml', data: te.encode(types) }, { name: '_rels/.rels', data: te.encode(rels) }, { name: 'word/document.xml', data: te.encode(document) }, { name: 'word/styles.xml', data: te.encode(styles) }, { name: 'word/_rels/document.xml.rels', data: te.encode(docRels) });
  for (const i of images.values()) files.push({ name: 'word/media/' + i.name, data: i.bytes });
  return zip(files);
}

/* ───── imagem -> bytes que o Word aceita (png/jpeg/gif) + tamanho em pixels ───── */
export async function prepareImage(bytes) {
  const b = bytes;
  const sniff = b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 ? 'gif' : '';
  const size = async (blob) => { const bm = await createImageBitmap(blob); const r = { w: bm.width, h: bm.height, bm }; return r; };
  if (sniff) {
    try { const s = await size(new Blob([b])); s.bm.close(); return { bytes: b, ext: sniff, w: s.w, h: s.h }; } catch { /* tenta converter */ }
  }
  // webp, bmp, svg… -> PNG
  let bm = null;
  try { bm = await createImageBitmap(new Blob([b])); } catch {
    bm = await new Promise((res, rej) => { // SVG e afins: pelo elemento <img> com data: URL (blob: não é permitido pela política do app)
      const fr = new FileReader();
      fr.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = fr.result; };
      fr.onerror = rej;
      fr.readAsDataURL(new Blob([b], { type: 'image/svg+xml' }));
    });
  }
  const w = bm.width || bm.naturalWidth || 400; const h = bm.height || bm.naturalHeight || 300;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bm, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png', w, h };
}
