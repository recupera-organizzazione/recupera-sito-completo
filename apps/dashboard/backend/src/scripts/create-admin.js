// Uso: ADMIN_EMAIL=admin@recupera.local ADMIN_PASSWORD='<password-forte>' [ADMIN_USER=admin] npm run create:admin
// Crea (o aggiorna) l'account admin singolo in Supabase Auth (auth.users via
// Admin API) con app_metadata.role='admin' — scrivibile solo con service_role,
// mai dall'utente. La password non viene mai stampata né scritta in repo.
// Richiede SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env.
import 'dotenv/config';
import { hasServiceRole, supabase } from '../db/supabaseClient.js';

const username = process.env.ADMIN_USER || 'admin';
const email = process.env.ADMIN_EMAIL || '';
const password = process.env.ADMIN_PASSWORD;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('ADMIN_EMAIL assente o non valida: esportala nel shell (mai in repo).');
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error('ADMIN_PASSWORD assente o < 12 caratteri: esportala nel shell (mai in repo, mai in history).');
  process.exit(1);
}
if (!hasServiceRole) {
  console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY assenti: impossibile usare la Admin API.');
  process.exit(1);
}

async function findUserIdByEmail(target) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = (data?.users || []).find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (found) return found.id;
    if (!data?.users?.length || data.users.length < 100) return null;
    page += 1;
  }
}

const attrs = {
  email,
  password,
  email_confirm: true,
  app_metadata: { role: 'admin' },
  user_metadata: { username },
};

const { error: createError } = await supabase.auth.admin.createUser(attrs);
if (createError && !/already been registered|already exists/i.test(createError.message)) {
  console.error('Errore creazione admin:', createError.message);
  process.exit(1);
}
if (createError) {
  const id = await findUserIdByEmail(email);
  if (!id) {
    console.error('Utente esistente ma non trovato: impossibile aggiornare.');
    process.exit(1);
  }
  const { error: updateError } = await supabase.auth.admin.updateUserById(id, attrs);
  if (updateError) {
    console.error('Errore aggiornamento admin:', updateError.message);
    process.exit(1);
  }
  console.log(`Account admin '${username}' <${email}> aggiornato (ruolo admin confermato).`);
} else {
  console.log(`Account admin '${username}' <${email}> creato con ruolo admin.`);
}
