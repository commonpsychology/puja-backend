// src/routes/sharedBookings.js
// Mounted in index.mjs as: app.use('/api/bookings', sharedBookingsRoutes)
//
// One combined endpoint the frontend can call BEFORE the user picks a time,
// right after they pick a date — so "you already have a booking that day"
// shows up immediately instead of only failing at final submit.

const express = require('express')
const router  = express.Router()
const { authenticate } = require('../middleware/auth')
const { clientHasBookingOnDate } = require('./controllers/appointmentController')

// GET /api/bookings/check-day?date=YYYY-MM-DD
// -> { hasBooking: boolean }
router.get('/check-day', authenticate, async (req, res) => {
  const { date } = req.query
  if (!date) return res.status(400).json({ message: 'date is required' })

  try {
    const hasBooking = await clientHasBookingOnDate(req.user.sub, date)
    return res.json({ hasBooking })
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

module.exports = router