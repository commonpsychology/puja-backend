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

// These MUST be registered before any '/admin/room-bookings/:id' or
// '/admin/rooms/:id' route elsewhere in the app — Express matches routes
// in registration order across the whole app, and a plain ':id' segment
// will happily swallow literal strings like 'seat-map' or 'seat-summary',
// passing them straight into a UUID column and crashing Postgres.
//
// Belt-and-braces: if this router happens to load AFTER the other admin
// room routers, these specific paths still win because they're not
// ':id'-shaped — but only as long as the *other* files' :id routes use a
// UUID-only regex (see note below). If your other files still use plain
// ':id', tighten them to ':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
// so they can never match 'seat-map' / 'seat-summary' again.
router.get(   '/admin/room-bookings/seat-map', ...adminOnly, ctrl.adminSeatMap)
router.get(   '/admin/rooms/seat-summary',     ...adminOnly, ctrl.adminRoomsSeatSummary)
router.delete('/admin/room-bookings/:id',      ...adminOnly, ctrl.adminDeleteBooking)

module.exports = router