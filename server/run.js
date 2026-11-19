'use strict';
// Ponto de entrada do servidor rodando sozinho, em segundo plano (sem janela), com o Node embutido numa CÓPIA do
// executável chamada "TT Note Server.exe" — assim o instalador do app (que fecha "TT Note.exe") não derruba o servidor.
//   TT Note Server.exe run.js [--dir pasta] [--port 8787] [--host 0.0.0.0]      (com ELECTRON_RUN_AS_NODE=1)
// Primeira execução: o administrador vem das variáveis TT_ADMIN_NAME / TT_ADMIN_PASS (não aparecem na linha de comando).
const fs = require('fs');
const path = require('path');
const { main, parseArgs } = require('./index');

const args = process.argv.slice(2);
const o = parseArgs(args);
const dir = o.dir || process.env.TT_SERVER_DATA || path.join(process.env.ProgramData || process.cwd(), 'TT Note Server');
fs.mkdirSync(dir, { recursive: true });
const logf = path.join(dir, 'server.log');
const log = (...a) => { try { fs.appendFileSync(logf, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch { /* sem log */ } };
console.log = log; console.error = log;
process.on('uncaughtException', (e) => { log('ERRO: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { log('ERRO: ' + (e && e.stack || e)); });

const pidf = path.join(dir, 'server.pid');
try { fs.writeFileSync(pidf, String(process.pid)); } catch { /* sem pid */ }
process.on('exit', () => { try { if (fs.readFileSync(pidf, 'utf8') === String(process.pid)) fs.unlinkSync(pidf); } catch { /* já removido */ } });

const rest = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--dir') { i++; continue; } rest.push(args[i]); }
if (process.env.TT_ADMIN_NAME && process.env.TT_ADMIN_PASS) rest.push('--admin', process.env.TT_ADMIN_NAME, process.env.TT_ADMIN_PASS);
main(['--dir', dir, ...rest]).catch((e) => { log('ERRO: ' + e.message); process.exit(1); });
