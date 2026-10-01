# GEMINI.md

@./AGENTS.md

## Regola unica: usa solo `AGENTS.md`

- Questo file serve solo a indirizzare Gemini CLI verso `AGENTS.md`, importato sopra con `@./AGENTS.md`.
- Tutte le istruzioni del progetto stanno **solo** in `AGENTS.md`: contesto, stack, vincoli, scope, comandi, convenzioni e definizione di "fatto". Leggilo per intero prima di ogni task e seguilo.
- Non scrivere regole di progetto in questo file. Per aggiungere o modificare una regola, modifica `AGENTS.md`.
- Se qualcosa qui sembra in contrasto con `AGENTS.md`, prevale `AGENTS.md`.
- Non creare altri file di istruzioni per agenti (`.gemini/` con istruzioni proprie, `.cursorrules`, `.github/copilot-instructions.md`, ecc.) senza richiesta esplicita dell'utente.
