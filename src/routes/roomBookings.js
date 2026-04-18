// src/routes/roomBookings.js
// Mounted in index.mjs as:  app.use('/api/room-bookings', roomBookingsRoutes)

const express      = require('express')
const router       = express.Router()
const { authenticate } = require('../middleware/auth')

const {
  listRooms,
  getRoom,
  checkAvailability,
  createRoomBooking,
  listMyBookings,
  getMyBooking,
  cancelMyBooking,
  attachPayment,
} = require('./controllers/roomBookingController')

// ── PUBLIC ────────────────────────────────────────────────────────────────
router.get('/rooms',        listRooms)           // GET  /api/room-bookings/rooms
router.get('/rooms/:id',    getRoom)             // GET  /api/room-bookings/rooms/:id
router.get('/availability', checkAvailability)   // GET  /api/room-bookings/availability?roomId=&date=

// ── CLIENT (authenticated) ────────────────────────────────────────────────
// ⚠️  /my MUST be registered BEFORE /:id
// Without this order, Express matches the string "my" as the :id param → 500
router.get ('/my',                  authenticate, listMyBookings)    // GET  /api/room-bookings/my
router.post('/',                    authenticate, createRoomBooking) // POST /api/room-bookings
router.get ('/:id',                 authenticate, getMyBooking)      // GET  /api/room-bookings/:id
router.patch('/:id/cancel',         authenticate, cancelMyBooking)   // PATCH /api/room-bookings/:id/cancel
router.post ('/:id/attach-payment', authenticate, attachPayment)     // POST /api/room-bookings/:id/attach-payment

module.exports = router