const express = require('express')
const { authenticate } = require('../middleware/auth')

const {
  bookAppointment,
  listMyAppointments,
  getAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getBookedSlots,
  getMySlots
} = require('./controllers/appointmentController')

const router = express.Router()

// 🔐 all routes require auth
router.use(authenticate)

// ============================================================
// ✅ IMPORTANT: SPECIFIC ROUTES FIRST (avoid route conflicts)
// ============================================================
router.get('/booked-slots', getBookedSlots)
router.get('/my-slots', getMySlots)

// ============================================================
// EXISTING ROUTES
// ============================================================
router.post('/', bookAppointment)
router.get('/', listMyAppointments)

// ⚠️ dynamic route MUST be after specific routes
router.get('/:id', getAppointment)

router.patch('/:id/cancel', cancelAppointment)
router.patch('/:id/reschedule', rescheduleAppointment)

module.exports = router