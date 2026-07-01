/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ============================================================
// 🟢 BOOK APPOINTMENT (SAFE)
// ============================================================
const bookAppointment = async (req, res) => {
  const { therapistId, scheduledAt, type = 'online', notes } = req.body
  const clientId = req.user.sub

  if (!therapistId || !scheduledAt) {
    return res.status(400).json({
      success: false,
      message: 'therapistId and scheduledAt are required.'
    })
  }

 try {
    await expireStaleHolds() // release any abandoned unpaid holds before checking conflicts

    // 1. Therapist exists
    const { data: therapist } = await supabase
      .from('therapists')
      .select('id, is_available, session_duration')
      .eq('id', therapistId)
      .maybeSingle()

    if (!therapist) {
      return res.status(404).json({ success: false, message: 'Therapist not found.' })
    }

    if (!therapist.is_available) {
      return res.status(409).json({
        success: false,
        message: 'This therapist is not accepting appointments.'
      })
    }

    // 2. Therapist conflict check
    const { data: conflict1 } = await supabase
      .from('appointments')
      .select('id')
      .eq('therapist_id', therapistId)
      .eq('scheduled_at', scheduledAt)
      .neq('status', 'cancelled')
      .maybeSingle()

    if (conflict1) {
      return res.status(409).json({
        success: false,
        message: 'This time slot is already booked.'
      })
    }

    // 3. Client conflict check
    const { data: conflict2 } = await supabase
      .from('appointments')
      .select('id')
      .eq('client_id', clientId)
      .eq('scheduled_at', scheduledAt)
      .neq('status', 'cancelled')
      .maybeSingle()

    if (conflict2) {
      return res.status(409).json({
        success: false,
        message: 'You already have an appointment at this time.'
      })
    }

    // 4. Insert booking
    const { data: appointment, error } = await supabase
      .from('appointments')
      .insert({
  client_id:        clientId,
  therapist_id:     therapistId,
  scheduled_at:     scheduledAt,
  duration_minutes: therapist.session_duration || 60,
  type,
  notes,
  status:           'pending',
  payment_status:   'unpaid',    // ← always explicit on creation
})
      .select()
      .single()

    if (error) {
      // 🔴 Handle race condition
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'This slot was just taken. Try another.'
        })
      }
      throw error
    }

    return res.status(201).json({
      success: true,
      message: 'Appointment booked successfully.',
      appointment
    })

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    })
  }
}


// ============================================================
// 🟢 GET BOOKED SLOTS (THERAPIST)
// ============================================================
const getBookedSlots = async (req, res) => {
  const { therapistId, date } = req.query

  if (!therapistId || !date) {
    return res.status(400).json({ message: 'therapistId and date are required' })
  }

  try {
    await expireStaleHolds() // release any abandoned unpaid holds before reporting availability

    const { data, error } = await supabase
      .from('appointments')
      .select('scheduled_at')
      .eq('therapist_id', therapistId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', `${date}T00:00:00`)
      .lte('scheduled_at', `${date}T23:59:59`)

    if (error) throw error

    const slots = (data || []).map(a => {
      const d = new Date(a.scheduled_at)
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    })

    return res.json({ slots, bookedSlots: slots })

  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}


// ============================================================
// 🟢 GET MY SLOTS
// ============================================================
const getMySlots = async (req, res) => {
  const { date } = req.query
  const clientId = req.user.sub

  if (!date) {
    return res.status(400).json({ message: 'date is required' })
  }

  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('scheduled_at')
      .eq('client_id', clientId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', `${date}T00:00:00`)
      .lte('scheduled_at', `${date}T23:59:59`)

    if (error) throw error

    const slots = (data || []).map(a => {
      const d = new Date(a.scheduled_at)
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    })

    return res.json({ slots, bookedSlots: slots })

  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}


// ============================================================
// 🟢 EXISTING FUNCTIONS (UNCHANGED BUT SAFE)
// ============================================================

const listMyAppointments = async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('appointments')
    .select(`*, therapists:therapist_id (id, profiles:user_id (full_name, avatar_url))`, { count: 'exact' })
    .eq('client_id', req.user.sub)
    .order('scheduled_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    return res.status(500).json({ success: false })
  }

  return res.json({
    success: true,
    appointments: data,
    pagination: { page: Number(page), limit: Number(limit), total: count }
  })
}


const getAppointment = async (req, res) => {
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', req.params.id)
    .eq('client_id', req.user.sub)
    .maybeSingle()

  if (!data) {
    return res.status(404).json({ success: false })
  }

  return res.json({ success: true, appointment: data })
}


const cancelAppointment = async (req, res) => {
  try {
    // Fetch first so we know whether this was a paid booking or an abandoned hold.
    const { data: existing, error: fetchErr } = await supabase
      .from('appointments')
      .select('id, payment_status')
      .eq('id', req.params.id)
      .eq('client_id', req.user.sub)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' })
    }

    const updatePayload = { status: 'cancelled' }
    // Only relabel payment_status if it was never paid — preserves the record
    // for bookings that *were* paid and are being cancelled for other reasons.
    if (existing.payment_status === 'unpaid') {
      updatePayload.payment_status = 'failed'
    }

    const { data, error } = await supabase
      .from('appointments')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('client_id', req.user.sub)
      .select()
      .single()

    if (error) throw error

    return res.json({ success: true, appointment: data })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}


const rescheduleAppointment = async (req, res) => {
  const { scheduledAt } = req.body

  const { data } = await supabase
    .from('appointments')
    .update({ scheduled_at: scheduledAt })
    .eq('id', req.params.id)
    .eq('client_id', req.user.sub)
    .select()
    .single()

  return res.json({ success: true, appointment: data })
}


// ============================================================
// 🟢 EXPIRE STALE UNPAID HOLDS
// Cancels any appointment still 'unpaid' after HOLD_MINUTES,
// freeing the slot. Called opportunistically from bookAppointment
// and getBookedSlots; wire to a real cron job too if available.
// ============================================================
const HOLD_MINUTES = 30

const expireStaleHolds = async () => {
  const cutoff = new Date(Date.now() - HOLD_MINUTES * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', payment_status: 'failed' })
    .eq('status', 'pending')
    .eq('payment_status', 'unpaid')
    .lt('created_at', cutoff)
    .select('id')

  if (error) {
    console.error('expireStaleHolds error:', error.message)
    return []
  }
  return data || []
}


// ============================================================
module.exports = {
  bookAppointment,
  listMyAppointments,
  getAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getBookedSlots,
  getMySlots,
  expireStaleHolds
}