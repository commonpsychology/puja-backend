/* eslint-disable no-undef */
const supabase = require('../../db/supabase')

async function getTherapistIdForUser(userId) {
  const { data } = await supabase.from('therapists').select('id').eq('user_id', userId).maybeSingle()
  return data?.id || null
}

// POST /therapist-portal/live-session/start  { appointment_id }
async function startLiveSession(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id
    const therapistId = await getTherapistIdForUser(userId)
    if (!therapistId) return res.status(404).json({ message: 'Therapist profile not found.' })

    const { appointment_id } = req.body
    if (!appointment_id) return res.status(400).json({ message: 'appointment_id is required.' })

    const { data: appt, error: aErr } = await supabase
      .from('appointments')
      .select('id, client_id, therapist_id, status, clients:profiles!appointments_client_id_fkey(full_name)')
      .eq('id', appointment_id)
      .eq('therapist_id', therapistId)
      .maybeSingle()

    if (aErr || !appt) return res.status(404).json({ message: 'Appointment not found for this therapist.' })

    const startedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('therapist_live_status')
      .upsert({
        therapist_id:   therapistId,
        status:         'in_session',
        appointment_id: appt.id,
        client_id:      appt.client_id,
        started_at:     startedAt,
        updated_at:     startedAt,
      }, { onConflict: 'therapist_id' })
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, liveStatus: data, client_name: appt.clients?.full_name || null })
  } catch (err) { next(err) }
}

// POST /therapist-portal/live-session/end
async function endLiveSession(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id
    const therapistId = await getTherapistIdForUser(userId)
    if (!therapistId) return res.status(404).json({ message: 'Therapist profile not found.' })

    const { data, error } = await supabase
      .from('therapist_live_status')
      .upsert({
        therapist_id:   therapistId,
        status:         'idle',
        appointment_id: null,
        client_id:      null,
        started_at:     null,
        updated_at:     new Date().toISOString(),
      }, { onConflict: 'therapist_id' })
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, liveStatus: data })
  } catch (err) { next(err) }
}

// GET /therapist-portal/live-session — restore state on page reload
async function getMyLiveSession(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id
    const therapistId = await getTherapistIdForUser(userId)
    if (!therapistId) return res.status(200).json({ liveStatus: null })

    const { data, error } = await supabase
      .from('therapist_live_status')
      .select('*, clients:profiles!therapist_live_status_client_id_fkey(full_name)')
      .eq('therapist_id', therapistId)
      .maybeSingle()

    if (error) throw error
    return res.status(200).json({ liveStatus: data || null })
  } catch (err) { next(err) }
}

// GET /admin/therapist-live-status — full roster + live info, for the seat grid
async function getAdminLiveStatuses(req, res, next) {
  try {
    const { data: therapists, error: tErr } = await supabase
      .from('therapists')
      .select('id, user_id, license_type, avatar_url, is_available, profiles:user_id(full_name)')
      .order('created_at', { ascending: true })
    if (tErr) throw tErr

    const { data: liveRows, error: lErr } = await supabase
      .from('therapist_live_status')
      .select('*, clients:profiles!therapist_live_status_client_id_fkey(full_name, avatar_url), appointments(scheduled_at, type)')
    if (lErr) throw lErr

    const liveMap = {}
    ;(liveRows || []).forEach(r => { liveMap[r.therapist_id] = r })

    const seats = (therapists || []).map(t => {
      const live = liveMap[t.id]
      return {
        therapist_id:     t.id,
        full_name:        t.profiles?.full_name || 'Therapist',
        license_type:     t.license_type,
        avatar_url:       t.avatar_url,
        is_available:     t.is_available,
        status:           live?.status === 'in_session' ? 'in_session' : 'idle',
        client_name:      live?.clients?.full_name || null,
        started_at:       live?.started_at || null,
        appointment_type: live?.appointments?.type || null,
      }
    })

    return res.status(200).json({ success: true, seats })
  } catch (err) { next(err) }
}

module.exports = { startLiveSession, endLiveSession, getMyLiveSession, getAdminLiveStatuses }