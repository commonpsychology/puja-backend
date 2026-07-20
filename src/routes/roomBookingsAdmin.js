// routes/roomBookingsAdmin.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/roomBookingController')
const { authenticate } = require('../middleware/auth')

function requireAdminOrStaff(req, res, next) {
  const role = req.user?.role
  if (!['admin', 'staff'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Admin or staff access required.' })
  }
  next()
}

const adminOnly = [authenticate, requireAdminOrStaff]

// Only the two NEW endpoints — rooms CRUD and booking list/status already
// live in adminRoomBookings.js / adminRooms.js, don't duplicate them here.
router.get(   '/admin/room-bookings/seat-map', ...adminOnly, ctrl.adminSeatMap)
router.get(   '/admin/rooms/seat-summary',     ...adminOnly, ctrl.adminRoomsSeatSummary)
router.delete('/admin/room-bookings/:id',      ...adminOnly, ctrl.adminDeleteBooking)

module.exports = router