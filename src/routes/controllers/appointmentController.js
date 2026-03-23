/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/appointments
const bookAppointment = async (req, res) => {
  const { therapistId, scheduledAt, type = 'online', notes } = req.body

  if (!therapistId || !scheduledAt) {
    return res.status(400).json({ success: false, message: 'therapistId and scheduledAt are required.' })
  }

  const { data: therapist } = await supabase
    .from('therapists')
    .select('id, is_available, session_duration')
    .eq('id', therapistId)
    .maybeSingle()

  if (!therapist) {
    return res.status(404).json({ success: false, message: 'Therapist not found.' })
  }

  if (!therapist.is_available) {
    return res.status(409).json({ success: false, message: 'This therapist is not currently accepting appointments.' })
  }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      client_id:        req.user.sub,
      therapist_id:     therapistId,
      scheduled_at:     scheduledAt,
      duration_minutes: therapist.session_duration || 60,
      type,
      notes,
      status:           'pending',
    })
    .select()
    .single()

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not book appointment.' })
  }

  return res.status(201).json({ success: true, message: 'Appointment booked successfully.', appointment })
}

// GET /api/appointments
const listMyAppointments = async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('appointments')
    .select(`
      *,
      therapists:therapist_id (
        id,
        profiles:user_id ( full_name, avatar_url )
      )
    `, { count: 'exact' })
    .eq('client_id', req.user.sub)
    .order('scheduled_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not fetch appointments.' })
  }

  return res.status(200).json({
    success: true,
    appointments: data,
    pagination: { page: Number(page), limit: Number(limit), total: count },
  })
}

// GET /api/appointments/:id
const getAppointment = async (req, res) => {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      *,
      therapists:therapist_id (
        id, consultation_fee,
        profiles:user_id ( full_name, avatar_url, phone )
      )
    `)
    .eq('id', req.params.id)
    .eq('client_id', req.user.sub)
    .maybeSingle()

  if (error || !data) {
    return res.status(404).json({ success: false, message: 'Appointment not found.' })
  }

  return res.status(200).json({ success: true, appointment: data })
}

// PATCH /api/appointments/:id/cancel
const cancelAppointment = async (req, res) => {
  const { reason } = req.body

  const { data: existing } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('client_id', req.user.sub)
    .maybeSingle()

  if (!existing) {
    return res.status(404).json({ success: false, message: 'Appointment not found.' })
  }

  if (['cancelled', 'completed'].includes(existing.status)) {
    return res.status(409).json({ success: false, message: `Appointment is already ${existing.status}.` })
  }

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', cancellation_reason: reason || null })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not cancel appointment.' })
  }

  return res.status(200).json({ success: true, message: 'Appointment cancelled.', appointment: data })
}

// PATCH /api/appointments/:id/reschedule
const rescheduleAppointment = async (req, res) => {
  const { scheduledAt } = req.body

  if (!scheduledAt) {
    return res.status(400).json({ success: false, message: 'scheduledAt is required.' })
  }

  const { data: existing } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('client_id', req.user.sub)
    .maybeSingle()

  if (!existing) {
    return res.status(404).json({ success: false, message: 'Appointment not found.' })
  }

  if (['cancelled', 'completed'].includes(existing.status)) {
    return res.status(409).json({ success: false, message: `Cannot reschedule a ${existing.status} appointment.` })
  }

  const { data, error } = await supabase
    .from('appointments')
    .update({ scheduled_at: scheduledAt, status: 'pending' })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not reschedule appointment.' })
  }

  return res.status(200).json({ success: true, message: 'Appointment rescheduled.', appointment: data })
}

module.exports = {
  bookAppointment,
  listMyAppointments,
  getAppointment,
  cancelAppointment,
  rescheduleAppointment,
}