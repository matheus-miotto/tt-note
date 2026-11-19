// Janela "Criar enquete" (notas normais e compartilhadas). Cada opção (e a pergunta) pode ter uma imagem.
import { MAX_OPTIONS, MAX_QUESTION, MAX_OPTION } from '../server/poll.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const imgFileOf = (e) => { const d = e.clipboardData || e.dataTransfer; if (!d) return null; const f = [...(d.files || [])].find((x) => /^image\//.test(x.type)); return f || null; };

// opts: { shared: bool (mostra "anônima"), okLabel, saveImage?: async (File) => { src, alt, wiki }  (sem isso, não há botão de imagem) }
//  →  Promise<{ question, questionImage, options: [{ text, image }], multi, anonymous } | null>
export function openPollDialog(opts = {}) {
  return new Promise((resolve) => {
    if (document.getElementById('pollDlg')) return resolve(null);
    const dlg = el('div'); dlg.id = 'pollDlg';
    const box = el('div', 'pd-box'); dlg.append(box);
    box.append(el('h2', null, '📊 Criar enquete'));
    // imagem anexada a um campo: { file, preview(el) }
    const picker = (holder, onChange) => {
      const st = { file: null };
      const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true;
      const btn = el('button', 'pd-ic pd-img', '🖼'); btn.type = 'button'; btn.title = 'Colocar uma imagem (ou cole um print no campo)';
      const thumb = el('span', 'pd-thumb'); thumb.hidden = true;
      const set = (f) => {
        st.file = f; thumb.textContent = '';
        if (f) { const r = new FileReader(); r.onload = () => { const im = el('img'); im.src = String(r.result); thumb.append(im); }; r.readAsDataURL(f); const x = el('span', 'pd-thumbx', '×'); x.title = 'Tirar a imagem'; x.onclick = (e) => { e.stopPropagation(); set(null); }; thumb.append(x); }
        thumb.hidden = !f; btn.classList.toggle('on', !!f); if (onChange) onChange();
      };
      btn.onclick = () => fi.click(); fi.onchange = () => { if (fi.files[0]) set(fi.files[0]); fi.value = ''; };
      holder.append(thumb, btn, fi); btn.hidden = !opts.saveImage;
      return { st, set };
    };
    const qrow = el('div', 'pd-qrow');
    const q = el('input', 'pd-q'); q.type = 'text'; q.placeholder = 'Pergunta'; q.maxLength = MAX_QUESTION; q.spellcheck = true;
    qrow.append(q); const qp = picker(qrow);
    q.addEventListener('paste', (e) => { const f = opts.saveImage && imgFileOf(e); if (f) { e.preventDefault(); qp.set(f); } });
    box.append(qrow);
    box.append(el('div', 'pd-lab', 'Opções'));
    const list = el('div', 'pd-list'); box.append(list);
    const rows = [];
    const addRow = (focus) => {
      if (rows.length >= MAX_OPTIONS) return;
      const r = el('div', 'pd-row'); const i = el('input'); i.type = 'text'; i.maxLength = MAX_OPTION; i.placeholder = 'Opção ' + (rows.length + 1); i.spellcheck = true;
      const up = el('button', 'pd-ic', '↑'); up.title = 'Subir'; const dn = el('button', 'pd-ic', '↓'); dn.title = 'Descer';
      const x = el('button', 'pd-ic', '✕'); x.title = 'Tirar esta opção';
      r.append(i); const pk = picker(r); r.append(up, dn, x); list.append(r); const row = { r, i, pk }; rows.push(row);
      i.addEventListener('paste', (e) => { const f = opts.saveImage && imgFileOf(e); if (f) { e.preventDefault(); pk.set(f); } });
      x.onclick = () => { if (rows.length <= 2) { i.value = ''; pk.set(null); return; } r.remove(); rows.splice(rows.indexOf(row), 1); relabel(); };
      up.onclick = () => { const k = rows.indexOf(row); if (k > 0) { list.insertBefore(r, rows[k - 1].r); [rows[k - 1], rows[k]] = [rows[k], rows[k - 1]]; } };
      dn.onclick = () => { const k = rows.indexOf(row); if (k < rows.length - 1) { list.insertBefore(rows[k + 1].r, r); [rows[k + 1], rows[k]] = [rows[k], rows[k + 1]]; } };
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); const k = rows.indexOf(row); if (k === rows.length - 1) addRow(true); else rows[k + 1].i.focus(); } });
      relabel(); if (focus) i.focus();
    };
    const relabel = () => { rows.forEach((z, k) => { z.i.placeholder = 'Opção ' + (k + 1); }); add.hidden = rows.length >= MAX_OPTIONS; };
    const add = el('button', 'pd-add', '＋ Adicionar opção'); add.onclick = () => addRow(true);
    box.append(add);
    const kind = el('div', 'pd-kind');
    kind.innerHTML = '<label><input type="radio" name="pdk" value="single" checked> Uma escolha</label><label><input type="radio" name="pdk" value="multi"> Várias escolhas</label>';
    box.append(kind);
    let anon = null;
    if (opts.shared) { const l = el('label', 'pd-anon'); anon = el('input'); anon.type = 'checkbox'; l.append(anon, ' Voto anônimo (ninguém vê quem votou em quê)'); box.append(l); }
    const err = el('div', 'pd-err'); box.append(err);
    const btns = el('div', 'pd-btns'); const cancel = el('button', null, 'Cancelar'); const ok = el('button', 'primary', opts.okLabel || 'Inserir'); btns.append(el('span', 'sp'), cancel, ok); box.append(btns);
    addRow(); addRow();
    let busy = false;
    const close = (v) => { dlg.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const submit = async () => {
      if (busy) return;
      const question = q.value.trim();
      const items = rows.map((z) => ({ text: z.i.value.trim(), file: z.pk.st.file })).filter((x) => x.text || x.file);
      if (!question) { err.textContent = 'Escreva a pergunta.'; q.focus(); return; }
      if (items.length < 2) { err.textContent = 'Coloque pelo menos 2 opções (texto e/ou imagem).'; return; }
      const named = items.filter((x) => x.text); if (new Set(named.map((x) => x.text.toLowerCase())).size !== named.length) { err.textContent = 'Há opções repetidas.'; return; }
      busy = true; ok.disabled = true; err.textContent = '';
      try {
        const total = items.filter((x) => x.file).length + (qp.st.file ? 1 : 0); let n = 0;
        const save = async (f) => { n++; err.textContent = `Enviando imagem ${n} de ${total}…`; return opts.saveImage(f); };
        const questionImage = qp.st.file ? await save(qp.st.file) : null;
        const options = [];
        for (const it of items) options.push({ text: it.text, image: it.file ? await save(it.file) : null });
        close({ question, questionImage, options, multi: kind.querySelector('input:checked').value === 'multi', anonymous: !!(anon && anon.checked) });
      } catch (e) { busy = false; ok.disabled = false; err.textContent = 'Não consegui enviar uma imagem: ' + (e && e.message ? e.message : 'erro'); }
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) close(null); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); submit(); } };
    document.addEventListener('keydown', onKey, true);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); rows[0].i.focus(); } });
    cancel.onclick = () => { if (!busy) close(null); }; ok.onclick = submit;
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg && !busy) close(null); });
    document.body.append(dlg); q.focus();
  });
}
