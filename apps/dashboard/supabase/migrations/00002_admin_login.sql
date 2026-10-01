-- ============================================================
-- ReCUPera - Dashboard Regionale CUP
-- Migrazione 00002: account admin singolo (login dashboard)
-- ============================================================
-- Credenziali MAI in chiaro: solo hash scrypt in password_hash
-- (formato scrypt$N$r$p$salt_b64$key_b64, cfr. backend/src/auth.js).
-- RLS abilitata SENZA policy anon/authenticated → default deny:
-- legge/scrive solo service_role dal backend. Nessuna policy anon
-- di proposito: la password non deve mai essere leggibile via API anon.
-- Seed: nessuno qui — usare backend `npm run create:admin`
-- (oppure hash inserito via operatore autorizzato, mai commitato).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
