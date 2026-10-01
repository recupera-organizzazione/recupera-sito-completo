const { supabase } = require('./supabase');

function raise(error) {
  if (!error) return;
  const err = new Error(error.message || 'Errore Supabase.');
  if (/not found/i.test(err.message)) err.status = 404;
  else if (/not available|already|forbidden|cannot cancel/i.test(err.message)) err.status = 409;
  throw err;
}

async function bookAvailableSlot(slotId, patientId) {
  const { data, error } = await supabase.rpc('book_available_slot', {
    p_slot_id: slotId,
    p_patient_id: patientId
  });
  raise(error);
  return data;
}

async function cancelAppointment(appointmentId, user) {
  const { data, error } = await supabase.rpc('cancel_appointment_and_reallocate', {
    p_appointment_id: appointmentId,
    p_actor_id: user.uid,
    p_actor_role: user.role
  });
  raise(error);
  return data;
}

async function joinWaitingList(data, patientId) {
  const { data: existingEntries, error: lookupError } = await supabase.from('waiting_list')
    .select('id,status,facility_ids,professional_ids,earliest_at,latest_at')
    .eq('patient_id', patientId).eq('specialty_id', data.specialtyId).eq('status', 'waiting');
  raise(lookupError);
  const sameValues = (left = [], right = []) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  const sameDate = (left, right) => left && right
    ? new Date(left).getTime() === new Date(right).getTime()
    : !left && !right;
  const existing = existingEntries.find(entry =>
    sameValues(entry.facility_ids, data.facilityIds || [])
    && sameValues(entry.professional_ids, data.professionalIds || [])
    && sameDate(entry.earliest_at, data.earliestDate)
    && sameDate(entry.latest_at, data.latestDate)
  );
  if (existing) return { entryId: existing.id, status: existing.status, alreadyWaiting: true };

  const { data: entry, error } = await supabase.from('waiting_list').insert({
    patient_id: patientId,
    specialty_id: data.specialtyId,
    facility_ids: data.facilityIds || [],
    professional_ids: data.professionalIds || [],
    earliest_at: data.earliestDate || null,
    latest_at: data.latestDate || null,
    priority_score: data.priorityScore || 0
  }).select('id,status').single();
  raise(error);
  return { entryId: entry.id, status: entry.status, alreadyWaiting: false };
}

module.exports = { bookAvailableSlot, cancelAppointment, joinWaitingList, raise };
