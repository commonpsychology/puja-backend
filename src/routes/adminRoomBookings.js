// src/routes/adminRoomBookings.js
// Mounted in index.mjs as: app.use('/api/admin/room-bookings', adminRoomBookingsRoutes)

const express = require('express')
const router  = express.Router()
const { authenticate, requireRole } = require('../middleware/auth') // adjust to your actual admin-guard middleware name

const {
  adminListBookings,
  adminGetBooking,
  adminUpdateBookingStatus,
} = require('./controllers/roomBookingController')

router.use(authenticate, requireRole(['admin', 'staff'])) // adjust to match your existing admin middleware pattern

router.get   ('/',               adminListBookings)
router.get   ('/:id',            adminGetBooking)
router.patch ('/:id/status',     adminUpdateBookingStatus)

module.exports = router