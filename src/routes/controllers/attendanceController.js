// src/routes/controllers/attendanceController.js
/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Helper: derive table name from event UUID ──────────────
function attendanceTable(eventId) {
  return 'attendance_' + eventId.replace(/-/g, '_')
}

// ── Helper: check if event attendance table exists ────────
async function tableExists(tableName) {
  const { data } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .eq('table_name', tableName)
    .maybeSingle()
  return !!data
}

// ============================================================
// GET /api/attendance/events
// List all active events (for the dropdown in the form)
// Public — no auth required
// ============================================================
const listEvents = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, event_type, location, is_online, starts_at, ends_at, capacity, is_active')
      .eq('is_active', true)
      .order('starts_at', { ascending: true })

    if (error) throw error
    return res.json({ success: true, events: data || [] })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ============================================================
// POST /api/attendance/register
// Submit attendance for an event
// Public — no auth required (anyone can attend)
// ============================================================
const registerAttendance = async (req, res) => {
  const {
    event_id,
    full_name,
    email,
    phone,
    organization,
    age,
    sex,
    designation,
    district,
    notes,
  } = req.body

  // ── Validation ──────────────────────────────────────────
  if (!event_id)   return res.status(400).json({ success:false, message:'event_id is required.' })
  if (!full_name?.trim()) return res.status(400).json({ success:false, message:'Full name is required.' })
  if (!email?.trim())     return res.status(400).json({ success:false, message:'Email is required.' })

  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRx.test(email.trim())) {
    return res.status(400).json({ success:false, message:'Please enter a valid email address.' })
  }

  if (age !== undefined && age !== null && age !== '') {
    const ageNum = Number(age)
    if (!Number.isInteger(ageNum) || ageNum < 1 || ageNum > 120) {
      return res.status(400).json({ success:false, message:'Age must be a number between 1 and 120.' })
    }
  }

  const validSex = ['male','female','other','prefer_not_to_say']
  if (sex && !validSex.includes(sex)) {
    return res.status(400).json({ success:false, message:`Sex must be one of: ${validSex.join(', ')}.` })
  }

  try {
    // ── 1. Verify event exists and is active ──────────────
    const { data: event, error: evErr } = await supabase
      .from('events')
      .select('id, title, is_active, capacity, starts_at')
      .eq('id', event_id)
      .maybeSingle()

    if (evErr) throw evErr
    if (!event) {
      return res.status(404).json({ success:false, message:'Event not found.' })
    }
    if (!event.is_active) {
      return res.status(409).json({ success:false, message:'This event is no longer accepting registrations.' })
    }

    const table = attendanceTable(event_id)

    // ── 2. Ensure the attendance table exists (safety net) ─
    const exists = await tableExists(table)
    if (!exists) {
      // Trigger the DB function manually as a fallback
      await supabase.rpc('create_event_attendance_table', { p_event_id: event_id })
    }

    // ── 3. Duplicate email check (same person, same event) ─
    const { data: existing, error: dupErr } = await supabase
      .from(table)
      .select('id, full_name, checked_in_at')
      .eq('event_id', event_id)
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()

    if (dupErr && dupErr.code !== 'PGRST116') throw dupErr  // PGRST116 = no rows

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `This email has already been registered for "${event.title}". Each person can only register once per event.`,
        already_registered_at: existing.checked_in_at,
        registered_name: existing.full_name,
      })
    }

    // ── 4. Capacity check ─────────────────────────────────
    if (event.capacity) {
      const { count, error: countErr } = await supabase
        .from(table)
        .select('id', { count:'exact', head:true })
        .eq('event_id', event_id)

      if (countErr) throw countErr

      if (count >= event.capacity) {
        return res.status(409).json({
          success: false,
          message: `Sorry, "${event.title}" is fully booked (${event.capacity} seats). No more registrations are being accepted.`,
        })
      }
    }

    // ── 5. Insert attendance record ───────────────────────
    const ipAddress =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      null

    const { data: record, error: insertErr } = await supabase
      .from(table)
      .insert({
        event_id,
        full_name:    full_name.trim(),
        email:        email.trim().toLowerCase(),
        phone:        phone?.trim()        || null,
        organization: organization?.trim() || null,
        age:          age ? Number(age)    : null,
        sex:          sex                  || null,
        designation:  designation?.trim()  || null,
        district:     district?.trim()     || null,
        notes:        notes?.trim()        || null,
        ip_address:   ipAddress,
      })
      .select()
      .single()

    if (insertErr) {
      // Handle race-condition duplicate (unique constraint violation)
      if (insertErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'This email was just registered for this event by someone else. Each person can only register once.',
        })
      }
      throw insertErr
    }

    return res.status(201).json({
      success: true,
      message: `You have been successfully registered for "${event.title}". See you there!`,
      record,
    })

  } catch (err) {
    console.error('[attendanceController] registerAttendance error:', err)
    return res.status(500).json({ success: false, message: err.message || 'Registration failed. Please try again.' })
  }
}

// ============================================================
// GET /api/attendance/records/:eventId
// Admin-only: list all attendees for an event
// ============================================================
const getEventAttendees = async (req, res) => {
  const { eventId } = req.params

  try {
    const { data: event } = await supabase
      .from('events')
      .select('id, title')
      .eq('id', eventId)
      .maybeSingle()

    if (!event) return res.status(404).json({ success:false, message:'Event not found.' })

    const table = attendanceTable(eventId)

    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count:'exact' })
      .eq('event_id', eventId)
      .order('checked_in_at', { ascending: false })

    if (error) throw error

    return res.json({ success:true, event_title: event.title, total: count, attendees: data || [] })
  } catch (err) {
    return res.status(500).json({ success:false, message: err.message })
  }
}

// ============================================================
// POST /api/attendance/events   (admin only)
// Create a new event
// ============================================================
const createEvent = async (req, res) => {
  const { title, description, event_type, location, is_online, meet_link, starts_at, ends_at, capacity } = req.body

  if (!title?.trim())  return res.status(400).json({ success:false, message:'Event title is required.' })
  if (!starts_at)      return res.status(400).json({ success:false, message:'starts_at is required.' })

  try {
    const { data, error } = await supabase
      .from('events')
      .insert({
        title:        title.trim(),
        description:  description?.trim() || null,
        event_type:   event_type || 'program',
        location:     location?.trim()    || null,
        is_online:    !!is_online,
        meet_link:    meet_link?.trim()   || null,
        starts_at,
        ends_at:      ends_at             || null,
        capacity:     capacity ? Number(capacity) : null,
        created_by:   req.user?.sub       || null,
      })
      .select()
      .single()

    if (error) throw error

    // The DB trigger auto-creates the attendance table.
    // Belt-and-suspenders: call the RPC too in case trigger was slow.
    await supabase.rpc('create_event_attendance_table', { p_event_id: data.id }).catch(() => {})

    return res.status(201).json({ success:true, message:'Event created.', event: data })
  } catch (err) {
    return res.status(500).json({ success:false, message: err.message })
  }
}

module.exports = {
  listEvents,
  registerAttendance,
  getEventAttendees,
  createEvent,
}