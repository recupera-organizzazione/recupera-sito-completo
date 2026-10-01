-- Senza questo indice ogni delete su appointments scansiona tutta slots (FK slots.appointment_id).
create index if not exists slots_appointment_idx on public.slots (appointment_id);
