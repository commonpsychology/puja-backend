// src/routes/therapistRoutes.js
const express = require('express')
const router  = express.Router()

const { authenticate }               = require('../middleware/auth')
const { getMyTherapistAppointments } = require('./controllers/adminController')
const { getAppointmentNote, upsertAppointmentNote } = require('../controllers/communityController')

// Supabase client (reuse same pattern as other controllers)
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// All therapist-portal routes require a valid JWT
router.use(authenticate)

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/therapist-portal/appointments
// ─────────────────────────────────────────────────────────────────────────────
router.get('/appointments', getMyTherapistAppointments)

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/therapist-portal/appointments/:id/status
// Therapists can only update status of their OWN appointments.
// Allowed transitions: pending → confirmed, confirmed → completed,
//                      any    → cancelled, any → no_show
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/appointments/:id/status', async (req, res, next) => {
  try {
    const userId = req.user?.sub || req.user?.id
    const { status } = req.body

    const ALLOWED = ['confirmed', 'completed', 'cancelled', 'no_show', 'pending']
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${ALLOWED.join(', ')}`,
      })
    }

    // Look up the therapist record that belongs to this user
    const { data: therapist, error: tErr } = await supabase
      .from('therapists')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()

    // Admin / staff bypass — they don't need a therapist row
    const isAdminOrStaff = ['admin', 'staff'].includes(req.user?.role)

    if (!therapist && !isAdminOrStaff) {
      if (tErr) return next(tErr)
      return res.status(403).json({
        success: false,
        message: 'Therapist profile not found for this account.',
      })
    }

    // Build update query — therapists can only touch their own appointments
    let query = supabase
      .from('appointments')
      .update({ status })
      .eq('id', req.params.id)

    // Ownership enforcement for non-admins
    if (therapist && !isAdminOrStaff) {
      query = query.eq('therapist_id', therapist.id)
    }

    const { data, error } = await query.select().single()

    if (error) return next(error)

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found, or you do not have permission to update it.',
      })
    }

    return res.status(200).json({ success: true, appointment: data })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET / PUT  /api/therapist-portal/appointments/:id/notes
// ─────────────────────────────────────────────────────────────────────────────
router.get('/appointments/:id/notes', getAppointmentNote)
router.put('/appointments/:id/notes', upsertAppointmentNote)

module.exports = router