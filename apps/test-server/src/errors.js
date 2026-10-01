export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Formato errori comune: { error: { code, message } }
export function gestisciErrori(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'json_non_valido', message: 'Body JSON non valido' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'errore_interno', message: 'Errore interno del server' } });
}

export function validazione(schema, dati) {
  const risultato = schema.safeParse(dati);
  if (!risultato.success) {
    const dettaglio = risultato.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new ApiError(400, 'richiesta_non_valida', dettaglio);
  }
  return risultato.data;
}
