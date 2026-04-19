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

// ✅ Public — no auth needed to check which slots are taken
router.get('/booked-slots', getBookedSlots)

// 🔐 Everything below requires auth
router.use(authenticate)

router.get('/my-slots', getMySlots)

router.post('/', bookAppointment)
router.get('/', listMyAppointments)

// ⚠️ dynamic route MUST be after specific routes
router.get('/:id', getAppointment)

router.patch('/:id/cancel', cancelAppointment)
router.patch('/:id/reschedule', rescheduleAppointment)

module.exports = router