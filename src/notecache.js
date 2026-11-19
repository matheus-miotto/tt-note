// As notas compartilhadas NÃO ficam guardadas neste PC: tudo mora no servidor.
// Este módulo existe só para apagar a cópia local que versões antigas criavam (IndexedDB "tt-notes").
try { indexedDB.deleteDatabase('tt-notes'); } catch { /* nada a apagar */ }

export async function cacheGet() { return null; }
export async function cachePut() { /* de propósito não guarda nada */ }
export async function cacheClear() { /* nada guardado */ }
