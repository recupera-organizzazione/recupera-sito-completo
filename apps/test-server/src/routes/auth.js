import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { firmaToken, soloAdmin, verificaAdmin } from '../auth.js';
import { ApiError, validazione } from '../errors.js';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

// Solo login: gli admin esistono solo se creati in Supabase Auth (nessuna registrazione).
// Le credenziali sono quelle della dashboard (stesso account, vedi verificaAdmin); test_server.admin_users
// resta come anagrafica locale, creata al primo accesso, per collegare le disdette all'admin.
authRouter.post('/login', async (req, res) => {
  const { username, password } = validazione(loginSchema, req.body ?? {});
  if (!(await verificaAdmin(username, password))) {
    throw new ApiError(401, 'credenziali_errate', 'Username o password errati');
  }
  const { rows: [admin] } = await pool.query(
    `insert into test_server.admin_users (username, password_hash)
     values ($1, 'credenziali in Supabase Auth')
     on conflict (username) do update set password_hash = excluded.password_hash
     returning id, username`,
    [username],
  );
  res.json({ token: firmaToken(admin), admin });
});

authRouter.get('/me', soloAdmin, (req, res) => {
  res.json({ admin: req.admin });
});
