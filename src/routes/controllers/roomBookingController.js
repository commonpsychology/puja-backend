// src/routes/controllers/roomBookingController.js
// ─────────────────────────────────────────────────────────────────────────────
// Room Booking System — matches existing patterns in appointmentController.js
// Handles: list rooms, check availability, book, cancel, admin CRUD
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../../db/supabase')
const { clientHasBookingOnDate } = require('./appointmentController')
// ↑ same folder as this file (src/routes/controllers/) — adjust only if yours
//   lives somewhere else.

const getUserId = (req) => req.user?.sub || req.user?.id
const SEATS_PER_ROOM = 7

function isOneBookingPerDayError(err) {
  return !!err && (
    err.code === 'P0001' ||
    (typeof err.message === 'string' && err.message.includes('ONE_BOOKING_PER_DAY'))
  )
}

// ============================================================
// 🟢 EXPIRE STALE UNPAID ROOM HOLDS
// Mirrors expireStaleHolds() in appointmentController.js — cancels any
// room_booking still 'pending' after HOLD_MINUTES, freeing the slot.
// ============================================================
const ROOM_HOLD_MINUTES = 30

async function expireStaleRoomHolds() {
  const cutoff = new Date(Date.now() - ROOM_HOLD_MINUTES * 60 * 1000).toISOString()
  try {
    await supabase
      .from('room_bookings')
      .update({ status: 'cancelled', payment_status: 'failed' })
      .eq('status', 'pending')
      .eq('payment_status', 'pending')
      .lt('created_at', cutoff)
  } catch (e) {
    console.error('expireStaleRoomHolds error:', e.message)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendNotification(userId, { title, message, type = 'system', link = null }) {
  try {
    await supabase.from('notifications').insert({
      user_id: userId, title, message, type, link, is_read: false,
    })
  } catch (_) {} // never let notification failure break main flow
}

async function logAudit(actorId, action, tableN, recordId, newData = {}) {
  try {
    await supabase.from('audit_logs').insert({
      actor_id: actorId, action, table_name: tableN,
      record_id: recordId, new_data: newData,
    })
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/room-bookings/rooms
// Public: list all active rooms
// ─────────────────────────────────────────────────────────────────────────────
async function listRooms(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, name, description, capacity, price_per_hour, amenities, images, sort_order')
      .eq('is_active', true)
      .order('sort_order')

    if (error) throw error

    return res.status(200).json({ success: true, rooms: data || [] })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/room-bookings/rooms/:id
// Public: single room detail
// ─────────────────────────────────────────────────────────────────────────────
async function getRoom(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', req.params.id)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Room not found.' })

    return res.status(200).json({ success: true, room: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/room-bookings/availability
// Query: roomId, date  →  returns booked time slots for that date
// ─────────────────────────────────────────────────────────────────────────────
async function checkAvailability(req, res, next) {
  try {
    await expireStaleRoomHolds()
    const { roomId, date } = req.query

    if (!roomId || !date) {
      return res.status(400).json({
        success: false,
        message: 'roomId and date are required.',
      })
    }

    const { data, error } = await supabase
      .from('room_bookings')
      .select('seat_number, start_time, end_time, status')
      .eq('room_id', roomId)
      .eq('booked_date', date)
      .not('status', 'in', '("cancelled")')

    if (error) throw error

    const bookedSlots = (data || []).map((b) => ({
      seatNumber: b.seat_number,
      start:      b.start_time,
      end:        b.end_time,
    }))

    return res.status(200).json({
      success: true,
      date,
      roomId,
      seatsPerRoom: SEATS_PER_ROOM,
      bookedSlots,
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/room-bookings
// Authenticated: book a room slot
//
// Body: { roomId, bookedDate, startTime, endTime, notes, paymentMethod }
// ─────────────────────────────────────────────────────────────────────────────
async function createRoomBooking(req, res, next) {
  try {
    const clientId = getUserId(req)
    if (!clientId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

await expireStaleRoomHolds()
    const { roomId, bookedDate, startTime, endTime, notes, paymentMethod, amount, seatNumber } = req.body
    // ── Validate required fields ────────────────────────────
    if (!roomId || !bookedDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'roomId, bookedDate, startTime, and endTime are required.',
      })
    }

    const seatNum = Number(seatNumber)
    if (!seatNum || seatNum < 1 || seatNum > SEATS_PER_ROOM) {
      return res.status(400).json({
        success: false,
        message: `Please select a valid seat (1–${SEATS_PER_ROOM}).`,
      })
    }

    if (startTime >= endTime) {
      return res.status(400).json({
        success: false,
        message: 'startTime must be before endTime.',
      })
    }

    // ── Room exists and is active ───────────────────────────
    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .select('id, name, price_per_hour, is_active')
      .eq('id', roomId)
      .maybeSingle()

    if (roomErr) throw roomErr
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' })
    if (!room.is_active) {
      return res.status(409).json({ success: false, message: 'This room is not available for booking.' })
    }

    // ── Conflict check: overlapping bookings for the SAME SEAT/room/date ──
    const { data: conflicts, error: conflictErr } = await supabase
      .from('room_bookings')
      .select('id, seat_number, start_time, end_time')
      .eq('room_id', roomId)
      .eq('booked_date', bookedDate)
      .eq('seat_number', seatNum)
      .not('status', 'in', '("cancelled")')

    if (conflictErr) throw conflictErr

    const hasConflict = (conflicts || []).some((b) => {
      // Overlap: existing.start < new.end AND existing.end > new.start
      return b.start_time < endTime && b.end_time > startTime
    })

 if (hasConflict) {
      return res.status(409).json({
        success: false,
        message: `Seat ${seatNum} is already booked for part of that time. Please choose a different seat or slot.`,
      })
    }

    // ── One booking (appointment OR room) per client per day ──
    const alreadyBookedToday = await clientHasBookingOnDate(clientId, bookedDate)
    if (alreadyBookedToday) {
      return res.status(409).json({
        success: false,
        code: 'ONE_BOOKING_PER_DAY',
        message: 'You can only have one appointment or room booking per day. You already have a booking on this date.',
      })
    }

// ── Calculate total amount ──────────────────────────────
    // Prefer the amount actually charged (the package price set on
    // OurplacePage) over the hourly-rate fallback — these two only match
    // by coincidence otherwise, which is what caused wrong amounts in
    // the admin Room Bookings tab.
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    const durationHours = ((eh * 60 + em) - (sh * 60 + sm)) / 60
    const computedAmount = Math.round(durationHours * Number(room.price_per_hour) * 100) / 100
    const totalAmount = (amount != null && !isNaN(Number(amount)))
      ? Number(amount)
      : computedAmount

    // ── Insert booking ──────────────────────────────────────
    const { data: booking, error: insertErr } = await supabase
      .from('room_bookings')
      .insert({
        client_id:      clientId,
        room_id:        roomId,
        seat_number:    seatNum,
        booked_date:    bookedDate,
        start_time:     startTime,
        end_time:       endTime,
        total_amount:   totalAmount,
        payment_method: paymentMethod || null,
        payment_status: 'pending',
        status:         'pending',
        notes:          notes || null,
      })
      .select(`
        *,
        room:room_id (id, name, price_per_hour, amenities)
      `)
      .single()

  if (insertErr) {
      // Race condition / overlap caught by DB constraint
      if (insertErr.code === '23P01' || insertErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'This slot was just taken. Please choose a different time.',
        })
      }
      if (isOneBookingPerDayError(insertErr)) {
        return res.status(409).json({
          success: false,
          code: 'ONE_BOOKING_PER_DAY',
          message: 'You can only have one appointment or room booking per day.',
        })
      }
      throw insertErr
    }

    // ── Notify admins ───────────────────────────────────────
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'staff'])

    for (const admin of (admins || [])) {
      await sendNotification(admin.id, {
        title:   `📅 New Room Booking — ${room.name}`,
        message: `Seat ${seatNum} booked for ${bookedDate} from ${startTime} to ${endTime}. Total: NPR ${totalAmount.toLocaleString()}. Payment pending.`,
        type:    'system',
        link:    '/staff/admin?tab=room-bookings',
      })
    }

return res.status(201).json({
      success: true,
      message: 'Room booked successfully. Please complete payment to confirm.',
      booking,
      paymentDetails: {
        amount:    totalAmount,
        currency:  'NPR',
        bookingId: booking.id,
      },
    })
  } catch (err) {
    if (isOneBookingPerDayError(err)) {
      return res.status(409).json({
        success: false,
        code: 'ONE_BOOKING_PER_DAY',
        message: 'You can only have one appointment or room booking per day.',
      })
    }
    next(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/room-bookings
// Authenticated: list my room bookings
// ─────────────────────────────────────────────────────────────────────────────
async function listMyBookings(req, res, next) {
  try {
    const clientId = getUserId(req)
    const { status, page = 1, limit = 10 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('room_bookings')
      .select(`
        id, booked_date, start_time, end_time, duration_hours,
        total_amount, payment_status, payment_method, status, notes,
        cancellation_reason, created_at,
        client:client_id (id, full_name, email, phone),
        room:room_id (id, name, price_per_hour),
        payment:payment_id (id, method, status, transaction_id, paid_at, amount, gateway_response)
      `, { count: 'exact' })
      .order('booked_date', { ascending: false })
      .order('start_time', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) throw error

    return res.status(200).json({
      success: true,
      bookings:   data || [],
      pagination: { page: Number(page), limit: Number(limit), total: count || 0 },
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/room-bookings/:id
// Authenticated: single booking (owner only)
// ─────────────────────────────────────────────────────────────────────────────
async function getMyBooking(req, res, next) {
  try {
    const clientId = getUserId(req)

    const { data, error } = await supabase
      .from('room_bookings')
      .select(`
        *,
        room:room_id (*),
        payment:payment_id (id, method, status, transaction_id, paid_at, amount)
      `)
      .eq('id', req.params.id)
      .eq('client_id', clientId)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Booking not found.' })

    return res.status(200).json({ success: true, booking: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/room-bookings/:id/cancel
// Authenticated: cancel own booking
// ─────────────────────────────────────────────────────────────────────────────
async function cancelMyBooking(req, res, next) {
  try {
    const clientId = getUserId(req)
    const { reason } = req.body

    // Fetch first to validate ownership
    const { data: existing, error: fetchErr } = await supabase
      .from('room_bookings')
      .select('id, status, client_id, booked_date, start_time, room_id')
      .eq('id', req.params.id)
      .eq('client_id', clientId)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) return res.status(404).json({ success: false, message: 'Booking not found.' })

    if (['cancelled', 'completed'].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a booking that is already ${existing.status}.`,
      })
    }

    const { data: updated, error: updateErr } = await supabase
      .from('room_bookings')
      .update({ status: 'cancelled', cancellation_reason: reason || null })
      .eq('id', req.params.id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // Notify admins
    const { data: admins } = await supabase
      .from('profiles').select('id').in('role', ['admin', 'staff'])
    for (const admin of (admins || [])) {
      await sendNotification(admin.id, {
        title:   '❌ Room Booking Cancelled',
        message: `Booking ${req.params.id.slice(0, 8)} for ${existing.booked_date} at ${existing.start_time} was cancelled by client.`,
        type:    'system',
        link:    '/staff/admin?tab=room-bookings',
      })
    }

    return res.status(200).json({ success: true, message: 'Booking cancelled.', booking: updated })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/room-bookings/:id/attach-payment
// Called after PaymentModal succeeds — links paymentId to booking
// Body: { paymentId, transactionId }
// ─────────────────────────────────────────────────────────────────────────────
async function attachPayment(req, res, next) {
  try {
    const clientId = getUserId(req)
    const { paymentId, transactionId } = req.body

    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'paymentId is required.' })
    }

    // Verify booking belongs to client
    const { data: booking, error: fetchErr } = await supabase
      .from('room_bookings')
      .select('id, client_id, total_amount, status')
      .eq('id', req.params.id)
      .eq('client_id', clientId)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' })
    if (booking.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot attach payment to a cancelled booking.' })
    }

    // Verify payment belongs to client
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .select('id, client_id, status, amount, method')
      .eq('id', paymentId)
      .eq('client_id', clientId)
      .maybeSingle()

    if (payErr) throw payErr
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' })

    // Link payment to booking
    const isCompleted = payment.status === 'completed'
    const { data: updated, error: updateErr } = await supabase
      .from('room_bookings')
      .update({
        payment_id:     paymentId,
        payment_status: isCompleted ? 'paid' : 'pending',
        payment_method: payment.method,
        status:         isCompleted ? 'confirmed' : 'pending',
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // Also update payment with room_booking_id + category
    await supabase
      .from('payments')
      .update({
        room_booking_id: req.params.id,
        category:        'room_booking',
      })
      .eq('id', paymentId)

    if (isCompleted) {
      await sendNotification(clientId, {
        title:   '✅ Room Booking Confirmed!',
        message: `Your room booking for ${booking.booked_date} has been confirmed. See you there!`,
        type:    'system',
        link:    '/portal?tab=bookings',
      })
    }

    return res.status(200).json({ success: true, booking: updated })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ADMIN ROUTES ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/room-bookings
async function adminListBookings(req, res, next) {
  try {
    const { page = 1, limit = 20, status, roomId, from, to } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('room_bookings')
      .select(`
        id, booked_date, start_time, end_time, duration_hours,
        total_amount, payment_status, payment_method, status, notes,
        cancellation_reason, created_at,
        client:client_id (id, full_name, email, phone),
        room:room_id (id, name, price_per_hour),
        payment:payment_id (id, method, status, transaction_id, paid_at, amount, gateway_response)
      `, { count: 'exact' })
      .order('booked_date',  { ascending: false })
      .order('start_time',   { ascending: true })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)
    if (roomId) query = query.eq('room_id', roomId)
    if (from)   query = query.gte('booked_date', from)
    if (to)     query = query.lte('booked_date', to)

    const { data, count, error } = await query
    if (error) throw error

    const enriched = (data || []).map((b) => ({
      ...b,
      needs_payment_review: b.payment_status === 'pending' && b.status !== 'cancelled',
      duration_label:       `${b.duration_hours}h`,
    }))

    return res.status(200).json({
      success: true,
      bookings:   enriched,
      pagination: { page: Number(page), limit: Number(limit), total: count || 0 },
    })
  } catch (err) { next(err) }
}

// GET /api/admin/room-bookings/:id
async function adminGetBooking(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('room_bookings')
      .select(`
        *,
        client:client_id (id, full_name, email, phone, avatar_url),
        room:room_id (*),
        payment:payment_id (*)
      `)
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Booking not found.' })

    return res.status(200).json({ success: true, booking: data })
  } catch (err) { next(err) }
}

// PATCH /api/admin/room-bookings/:id/status
// Admin confirms, cancels, or marks as completed/no_show
async function adminUpdateBookingStatus(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { status, reason, paymentStatus } = req.body

    const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${validStatuses.join(', ')}`,
      })
    }

    const { data: booking, error: fetchErr } = await supabase
      .from('room_bookings')
      .select('*, client_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' })

    const updatePayload = {
      status,
      ...(reason        && { cancellation_reason: reason }),
      ...(paymentStatus && { payment_status: paymentStatus }),
    }

    const { data: updated, error: updateErr } = await supabase
      .from('room_bookings')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // Notify client
    const notifMap = {
      confirmed: { title: '✅ Room Booking Confirmed!',  message: `Your booking for ${booking.booked_date} at ${booking.start_time} has been confirmed.` },
      cancelled: { title: '❌ Room Booking Cancelled',    message: `Your booking for ${booking.booked_date} has been cancelled. ${reason ? 'Reason: ' + reason : ''}` },
      completed: { title: '✅ Room Session Completed',    message: `Your room session on ${booking.booked_date} has been marked as completed. Thank you!` },
      no_show:   { title: '⚠️ Missed Room Booking',      message: `You were marked as no-show for your booking on ${booking.booked_date}.` },
    }

    if (notifMap[status]) {
      await sendNotification(booking.client_id, {
        ...notifMap[status],
        type: 'system',
        link: '/portal?tab=bookings',
      })
    }

    await logAudit(adminId, `ROOM_BOOKING_${status.toUpperCase()}`, 'room_bookings', id, updatePayload)

    return res.status(200).json({ success: true, booking: updated })
  } catch (err) { next(err) }
}

// ── ADMIN: Room CRUD ─────────────────────────────────────────

// GET /api/admin/rooms
async function adminListRooms(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('sort_order')

    if (error) throw error
    return res.status(200).json({ success: true, rooms: data || [] })
  } catch (err) { next(err) }
}

// POST /api/admin/rooms
async function adminCreateRoom(req, res, next) {
  try {
    const { name, description, capacity, pricePerHour, amenities, images, sortOrder } = req.body

    if (!name || pricePerHour === undefined) {
      return res.status(400).json({ success: false, message: 'name and pricePerHour are required.' })
    }

    const { data, error } = await supabase
      .from('rooms')
      .insert({
        name,
        description:    description  || null,
        capacity:       capacity      || 1,
        price_per_hour: Number(pricePerHour),
        amenities:      amenities     || [],
        images:         images        || [],
        sort_order:     sortOrder     || 0,
        is_active:      true,
      })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, room: data })
  } catch (err) { next(err) }
}

// PUT /api/admin/rooms/:id
async function adminUpdateRoom(req, res, next) {
  try {
    const { name, description, capacity, pricePerHour, amenities, images, sortOrder, isActive } = req.body

    const updatePayload = {}
    if (name         !== undefined) updatePayload.name           = name
    if (description  !== undefined) updatePayload.description    = description
    if (capacity     !== undefined) updatePayload.capacity       = capacity
    if (pricePerHour !== undefined) updatePayload.price_per_hour = Number(pricePerHour)
    if (amenities    !== undefined) updatePayload.amenities      = amenities
    if (images       !== undefined) updatePayload.images         = images
    if (sortOrder    !== undefined) updatePayload.sort_order     = sortOrder
    if (isActive     !== undefined) updatePayload.is_active      = isActive

    const { data, error } = await supabase
      .from('rooms')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, room: data })
  } catch (err) { next(err) }
}

// DELETE /api/admin/rooms/:id
async function adminDeleteRoom(req, res, next) {
  try {
    // Soft delete — just deactivate so existing bookings retain the reference
    const { data, error } = await supabase
      .from('rooms')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    return res.status(200).json({ success: true, message: 'Room deactivated.', room: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  // Public
  listRooms,
  getRoom,
  checkAvailability,
  expireStaleRoomHolds,
  // Client (authenticated)
  createRoomBooking,
  listMyBookings,
  getMyBooking,
  cancelMyBooking,
  attachPayment,
  // Admin
  adminListBookings,
  adminGetBooking,
  adminUpdateBookingStatus,
  adminListRooms,
  adminCreateRoom,
  adminUpdateRoom,
  adminDeleteRoom,
}