// Uso: npm run import:csv -- [../data/monitoraggio-...csv]
// Richiede backend/.env (copiato da backend/.env.example) con SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY. Senza chiavi: dry-run di sola validazione.
// Import idempotente: upsert prestazioni per descrizione + rilevazioni su
// UNIQUE(asl_id, prestazione_id, settimana). Assert attesi: 414 righe, 6 ASL, 69 prestazioni.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseUploadedCsv } from '../db/store.js';
import { upsertRows } from '../db/store.js';
import { hasServiceRole } from '../db/supabaseClient.js';

const fileArg = process.argv[2] || '../data/monitoraggio-tempi-di-attesa-07_11-ottobre-2024.csv';
const file = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(file)) {
  console.error(`File CSV non trovato: ${file}`);
  process.exit(1);
}

// decode robusto UTF-8 → win1252 (il CSV originale è cp1252, byte 0x92 = ’;
// la copia in data/ è normalizzata UTF-8). parseUploadedCsv lo gestisce.
const rows = parseUploadedCsv(fs.readFileSync(file));
const asls = new Set(rows.map((r) => r.asl_id).filter(Boolean));
const prest = new Set(rows.map((r) => r.descrizione).filter(Boolean));
console.log(`Lette ${rows.length} righe, ${asls.size} ASL, ${prest.size} prestazioni da ${file}`);

const totPerAsl = {};
for (const r of rows) totPerAsl[r.asl_id] = (totPerAsl[r.asl_id] || 0) + r.prenotazioni;
console.log('Totali PRENOTAZIONI per ASL (attesi BA 19370, FG 10042, LE 7754, TA 7113, BT 5607, BR 4686):', totPerAsl);

if (rows.length !== 414 || asls.size !== 6 || prest.size !== 69) {
  console.error(`Assert fallito: attesi 414/6/69, letti ${rows.length}/${asls.size}/${prest.size}`);
  process.exit(1);
}

if (!hasServiceRole) {
  console.log('SUPABASE_URL/SERVICE_ROLE assenti: dry-run di sola validazione, nessuna scrittura.');
  process.exit(0);
}

console.log('Upsert su Supabase in corso...');
console.log('Importazione completata:', await upsertRows(rows));
process.exit(0);
