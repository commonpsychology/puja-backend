/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Kathmandu is UTC+5:45 — must match the `Asia/Kathmandu` timezone used in
// the `scheduled_date` generated column / DB trigger, or the app-level
// pre-check and the DB-level trigger could disagree on which calendar day a
// slot falls on near midnight.
const KATHMANDU_OFFSET_MIN = 5 * 60 + 45

function kathmanduDateFromISO(iso) {
  const d = new Date(iso)
  const shifted = new Date(d.getTime() + KATHMANDU_OFFSET_MIN * 60000)
  return shifted.toISOString().split('T')[0] // YYYY-MM-DD
}

// Friendly message when the DB trigger rejects an insert/update because the
// client already has a booking (appointment OR room) that day.
function isOneBookingPerDayError(err) {
  return !!err && (
    err.code === 'P0001' ||
    (typeof err.message === 'string' && err.message.includes('ONE_BOOKING_PER_DAY'))
  )
}

// ============================================================
// 🟢 ONE BOOKING (appointment OR room) PER CLIENT PER DAY — pre-check
// Cheap up-front check so the user gets a clean 409 instead of a raw
// Postgres trigger exception. The DB trigger (see supabase_migrations.sql)
// is the real source of truth / race-condition guard.
// ============================================================
const clientHasBookingOnDate = async (clientId, dateStr, { excludeAppointmentId } = {}) => {
  const [{ data: appts }, { data: rooms }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id')
      .eq('client_id', clientId)
      .neq('status', 'cancelled')
      .eq('scheduled_date', dateStr) // generated column, see migration
      .then(r => ({ data: r.data || [] })),
    supabase
      .from('room_bookings')
      .select('id')
      .eq('client_id', clientId)
      .neq('status', 'cancelled')
      .eq('booked_date', dateStr)
      .then(r => ({ data: r.data || [] })),
  ])

  const applicableAppts = excludeAppointmentId
    ? appts.filter(a => a.id !== excludeAppointmentId)
    : appts

  return (applicableAppts.length > 0) || (rooms.length > 0)
}


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
    // ⚠️ Intentionally NOT filtered by `type`. This is what makes booking one
    // mode (call/video/in-person) lock the ENTIRE slot for every mode — the
    // unique index behind this (idx_appt_therapist_time_unique) is also keyed
    // only on (therapist_id, scheduled_at), not type. Do not add `type` here.
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

    // 3. Client conflict check (same exact timestamp)
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

    // 4. One booking (appointment OR room) per client per day
    const targetDate = kathmanduDateFromISO(scheduledAt)
    const alreadyBookedToday = await clientHasBookingOnDate(clientId, targetDate)
    if (alreadyBookedToday) {
      return res.status(409).json({
        success: false,
        code: 'ONE_BOOKING_PER_DAY',
        message: 'You can only have one appointment or room booking per day. You already have a booking on this date.'
      })
    }

    // 5. Insert booking
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
      // 🔴 Handle race conditions
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'This slot was just taken. Try another.'
        })
      }
      if (isOneBookingPerDayError(error)) {
        return res.status(409).json({
          success: false,
          code: 'ONE_BOOKING_PER_DAY',
          message: 'You can only have one appointment or room booking per day. You already have a booking on this date.'
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
    if (isOneBookingPerDayError(err)) {
      return res.status(409).json({
        success: false,
        code: 'ONE_BOOKING_PER_DAY',
        message: 'You can only have one appointment or room booking per day. You already have a booking on this date.'
      })
    }
    return res.status(500).json({
      success: false,
      message: err.message
    })
  }
}


// ============================================================
// 🟢 GET BOOKED SLOTS (THERAPIST)
// Returned regardless of `type` — the frontend must NOT filter these by the
// session type the visitor currently has selected, otherwise a slot booked
// as "video call" would incorrectly show as free for "in-person". These are
// the slots that are booked, full stop.
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
// 🟢 CHECK-DAY — has this client already booked anything today?
// Lets the frontend disable a date up front (before picking a time) instead
// of only failing at final submit. Mount as GET /appointments/check-day?date=
// if you want it on this router too (also provided as a combined endpoint
// in sharedBookingController.js covering both appointments + rooms).
// ============================================================
const checkDayAvailability = async (req, res) => {
  const { date } = req.query
  const clientId = req.user.sub

  if (!date) {
    return res.status(400).json({ message: 'date is required' })
  }

  try {
    const hasBooking = await clientHasBookingOnDate(clientId, date)
    return res.json({ hasBooking })
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
}


// ============================================================
// 🟢 PRECHECK — can this exact therapist+time+client be booked right now?
// Called the moment the user picks a time in Step 3, before Confirm/Payment,
// so conflicts surface immediately with a specific reason.
// ============================================================
const canBookSlot = async (req, res) => {
  const { therapistId, scheduledAt } = req.query
  const clientId = req.user.sub

  if (!therapistId || !scheduledAt) {
    return res.status(400).json({ ok: false, reason: 'missing_params', message: 'therapistId and scheduledAt are required.' })
  }

  try {
    await expireStaleHolds()

    const { data: therapist } = await supabase
      .from('therapists')
      .select('id, is_available')
      .eq('id', therapistId)
      .maybeSingle()

    if (!therapist) {
      return res.json({ ok: false, reason: 'therapist_not_found', message: 'Therapist not found.' })
    }
    if (!therapist.is_available) {
      return res.json({ ok: false, reason: 'therapist_unavailable', message: 'This therapist is not accepting appointments.' })
    }

    const { data: slotTaken } = await supabase
      .from('appointments')
      .select('id')
      .eq('therapist_id', therapistId)
      .eq('scheduled_at', scheduledAt)
      .neq('status', 'cancelled')
      .maybeSingle()

    if (slotTaken) {
      return res.json({ ok: false, reason: 'slot_taken', message: 'This time slot is already booked.' })
    }

    const { data: clientSameTime } = await supabase
      .from('appointments')
      .select('id')
      .eq('client_id', clientId)
      .eq('scheduled_at', scheduledAt)
      .neq('status', 'cancelled')
      .maybeSingle()

    if (clientSameTime) {
      return res.json({ ok: false, reason: 'own_double_booking', message: 'You already have an appointment at this exact time.' })
    }

    const targetDate = kathmanduDateFromISO(scheduledAt)
    const dayTaken = await clientHasBookingOnDate(clientId, targetDate)
    if (dayTaken) {
      return res.json({
        ok: false,
        reason: 'day_limit',
        message: 'You already have a booking (appointment or room) on this day. Only one booking per day is allowed.'
      })
    }

    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, reason: 'error', message: err.message })
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


// Cancelling sets status = 'cancelled', which:
//   • drops out of idx_appt_therapist_time_unique → frees the slot for
//     the therapist (any mode) immediately
//   • drops out of idx_appt_client_time_unique → frees the client too
//   • drops out of the one-booking-per-day check (trigger explicitly
//     early-returns when NEW.status = 'cancelled') → client can book
//     something else that same day right away
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
  const clientId = req.user.sub

  try {
    // Rescheduling is really "cancel this slot, take a new one" — so it must
    // go through the same day-limit + conflict checks as a fresh booking,
    // otherwise a client could dodge the one-per-day rule by rescheduling.
    const { data: existing } = await supabase
      .from('appointments')
      .select('id, therapist_id')
      .eq('id', req.params.id)
      .eq('client_id', clientId)
      .maybeSingle()

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' })
    }

    const { data: conflict } = await supabase
      .from('appointments')
      .select('id')
      .eq('therapist_id', existing.therapist_id)
      .eq('scheduled_at', scheduledAt)
      .neq('status', 'cancelled')
      .maybeSingle()

    if (conflict) {
      return res.status(409).json({ success: false, message: 'That new time is already booked.' })
    }

    const targetDate = kathmanduDateFromISO(scheduledAt)
    const alreadyBookedToday = await clientHasBookingOnDate(clientId, targetDate, {
      excludeAppointmentId: existing.id,
    })
    if (alreadyBookedToday) {
      return res.status(409).json({
        success: false,
        code: 'ONE_BOOKING_PER_DAY',
        message: 'You can only have one appointment or room booking per day.'
      })
    }

    const { data, error } = await supabase
      .from('appointments')
      .update({ scheduled_at: scheduledAt })
      .eq('id', req.params.id)
      .eq('client_id', clientId)
      .select()
      .single()

    if (error) {
      if (isOneBookingPerDayError(error)) {
        return res.status(409).json({
          success: false,
          code: 'ONE_BOOKING_PER_DAY',
          message: 'You can only have one appointment or room booking per day.'
        })
      }
      throw error
    }

    return res.json({ success: true, appointment: data })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
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
  checkDayAvailability,
  expireStaleHolds,
  clientHasBookingOnDate,
  kathmanduDateFromISO,
}