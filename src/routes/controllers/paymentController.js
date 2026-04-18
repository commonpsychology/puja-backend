// src/routes/controllers/paymentConfirmationController.js
// ─────────────────────────────────────────────────────────────────────────────
// Centralized payment confirmation system
// Handles: QR/eSewa/Khalti (admin approves) + COD (flag if unpaid on delivery)
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../../db/supabase')

const getUserId = (req) => req.user?.sub || req.user?.id

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendNotification(userId, { title, message, type = 'payment', link = null }) {
  await supabase.from('notifications').insert({
    user_id: userId, title, message, type, link, is_read: false,
  })
}

async function logAudit(actorId, action, tableN, recordId, newData = {}) {
  await supabase.from('audit_logs').insert({
    actor_id: actorId, action, table_name: tableN,
    record_id: recordId, new_data: newData,
  }).catch(() => {})  // never let audit failure break the main flow
}

function deriveCategory(payment) {
  return payment.category ||
    (payment.appointment_id ? 'appointment' : payment.order_id ? 'order' : 'other')
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/initiate
// Creates a pending payment record. Works for store, booking, course, workshop.
// ─────────────────────────────────────────────────────────────────────────────
async function initiatePayment(req, res, next) {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const {
      appointmentId, orderId, amount, currency = 'NPR',
      method, transactionId, gatewayResponse,
      // optional: for workshops / courses (stored in metadata)
      workshopId, courseId, referenceCode, notes,
    } = req.body

    if (!amount || !method)
      return res.status(400).json({ success: false, message: 'amount and method are required.' })

    const category = appointmentId ? 'appointment' : orderId ? 'order' : 'other'

    // COD payments stay pending_cod — never auto-complete
    const initialStatus = method === 'cash' || method === 'cod'
      ? 'pending_cod'
      : 'pending'

    // Build metadata for workshop/course tracking
    const metadata = {}
    if (workshopId)      metadata.workshop_id    = workshopId
    if (courseId)        metadata.course_id      = courseId
    if (referenceCode)   metadata.reference_code = referenceCode
    if (notes)           metadata.notes          = notes

    const insertPayload = {
      client_id:        userId,
      appointment_id:   appointmentId  || null,
      order_id:         orderId        || null,
      amount:           Number(amount),
      currency,
      method,
      category,
      status:           initialStatus,
      transaction_id:   transactionId  || null,
      gateway_response: gatewayResponse
        ? (typeof gatewayResponse === 'string' ? JSON.parse(gatewayResponse) : gatewayResponse)
        : (Object.keys(metadata).length ? metadata : null),
      paid_at:          null,   // set only on admin approval
    }

    const { data, error } = await supabase
      .from('payments').insert(insertPayload).select().single()

    if (error) throw error

    // Notify admin of new pending payment (QR / digital wallet)
    if (method !== 'cash' && method !== 'cod') {
      const adminProfiles = await supabase
        .from('profiles').select('id').eq('role', 'admin')
      for (const admin of (adminProfiles.data || [])) {
        await sendNotification(admin.id, {
          title:   `New pending payment — NPR ${Number(amount).toLocaleString()}`,
          message: `Method: ${method}. Transaction ID: ${transactionId || 'not provided'}. Review in admin dashboard.`,
          type:    'payment',
          link:    '/staff/admin?tab=payments',
        })
      }
    }

    return res.status(201).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/payments/:id/approve
// Admin manually approves a payment after verifying screenshot/QR/eSewa.
// ─────────────────────────────────────────────────────────────────────────────
async function approvePayment(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { transactionId, adminNote } = req.body

    // Fetch the payment
    const { data: payment, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', id).single()
    if (fetchErr || !payment)
      return res.status(404).json({ success: false, message: 'Payment not found.' })

    if (payment.status === 'completed')
      return res.status(400).json({ success: false, message: 'Payment already completed.' })

    // Mark completed
    const updatePayload = {
      status:         'completed',
      paid_at:        new Date().toISOString(),
      transaction_id: transactionId || payment.transaction_id,
      gateway_response: {
        ...(payment.gateway_response || {}),
        admin_approved_by:  adminId,
        admin_approved_at:  new Date().toISOString(),
        admin_note:         adminNote || null,
      },
    }

    const { data: updated, error: updateErr } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (updateErr) throw updateErr

    // Cascade: confirm linked appointment
    if (payment.appointment_id) {
      await supabase.from('appointments')
        .update({ status: 'confirmed' })
        .eq('id', payment.appointment_id)
        .in('status', ['pending'])
    }

    // Cascade: confirm linked order
    if (payment.order_id) {
      await supabase.from('orders')
        .update({ status: 'confirmed' })
        .eq('id', payment.order_id)
        .in('status', ['pending'])
    }

    // Notify client
    await sendNotification(payment.client_id, {
      title:   '✅ Payment Confirmed!',
      message: `Your payment of NPR ${Number(payment.amount).toLocaleString()} via ${payment.method} has been verified and confirmed.`,
      type:    'payment',
      link:    '/portal',
    })

    await logAudit(adminId, 'PAYMENT_APPROVED', 'payments', id, updatePayload)

    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/payments/:id/reject
// Admin rejects a payment (screenshot unclear, wrong amount, fraud).
// ─────────────────────────────────────────────────────────────────────────────
async function rejectPayment(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { reason } = req.body

    const { data: payment, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', id).single()
    if (fetchErr || !payment)
      return res.status(404).json({ success: false, message: 'Payment not found.' })

    const updatePayload = {
      status: 'failed',
      gateway_response: {
        ...(payment.gateway_response || {}),
        admin_rejected_by: adminId,
        admin_rejected_at: new Date().toISOString(),
        rejection_reason:  reason || 'Rejected by admin.',
      },
    }

    const { data: updated, error: updateErr } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (updateErr) throw updateErr

    // Notify client
    await sendNotification(payment.client_id, {
      title:   '❌ Payment Not Verified',
      message: `Your payment of NPR ${Number(payment.amount).toLocaleString()} could not be verified. Reason: ${reason || 'Please contact us for details.'}`,
      type:    'payment',
      link:    '/contact',
    })

    await logAudit(adminId, 'PAYMENT_REJECTED', 'payments', id, updatePayload)

    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/payments/:id/cod-confirm
// Admin marks COD as paid when item is delivered and cash collected.
// ─────────────────────────────────────────────────────────────────────────────
async function confirmCOD(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { collectedAt, collectedBy, note } = req.body

    const { data: payment, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', id).single()
    if (fetchErr || !payment)
      return res.status(404).json({ success: false, message: 'Payment not found.' })

    const updatePayload = {
      status:  'completed',
      method:  'cash',
      paid_at: collectedAt || new Date().toISOString(),
      gateway_response: {
        ...(payment.gateway_response || {}),
        cod_confirmed_by: adminId,
        cod_confirmed_at: new Date().toISOString(),
        collected_by:     collectedBy || null,
        note:             note || null,
      },
    }

    const { data: updated, error: updateErr } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (updateErr) throw updateErr

    if (payment.order_id) {
      await supabase.from('orders')
        .update({ status: 'delivered' })
        .eq('id', payment.order_id)
    }

    await sendNotification(payment.client_id, {
      title:   '✅ Cash Payment Received',
      message: `Thank you! Cash payment of NPR ${Number(payment.amount).toLocaleString()} has been received and your order is complete.`,
      type:    'payment',
      link:    '/portal',
    })

    await logAudit(adminId, 'COD_CONFIRMED', 'payments', id, updatePayload)

    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/payments/:id/cod-flag
// Flag a COD order where client refused to pay on delivery.
// ─────────────────────────────────────────────────────────────────────────────
async function flagCOD(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { reason } = req.body

    const { data: payment, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', id).single()
    if (fetchErr || !payment)
      return res.status(404).json({ success: false, message: 'Payment not found.' })

    const updatePayload = {
      status: 'failed',
      gateway_response: {
        ...(payment.gateway_response || {}),
        cod_flagged_by:   adminId,
        cod_flagged_at:   new Date().toISOString(),
        cod_flag_reason:  reason || 'Client refused payment on delivery.',
      },
    }

    const { data: updated, error } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (error) throw error

    // Mark order as cancelled
    if (payment.order_id) {
      await supabase.from('orders')
        .update({ status: 'cancelled', notes: `COD refused: ${reason || 'client refused'}` })
        .eq('id', payment.order_id)
    }

    await sendNotification(payment.client_id, {
      title:   '⚠️ COD Order Issue',
      message: `Your cash-on-delivery order could not be completed. Please contact us to resolve this.`,
      type:    'payment',
      link:    '/contact',
    })

    await logAudit(adminId, 'COD_FLAGGED', 'payments', id, updatePayload)

    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/payments  — all payments with filters
// ─────────────────────────────────────────────────────────────────────────────
async function getAllPaymentsAdmin(req, res, next) {
  try {
    const { page = 1, limit = 20, method, status, category, from, to } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('payments')
      .select(`
        id, amount, currency, method, category, status,
        transaction_id, paid_at, created_at,
        appointment_id, order_id, gateway_response,
        client:client_id (id, full_name, email, phone),
        appointment:appointment_id (
          id, scheduled_at, type, status,
          therapist:therapist_id (profiles:user_id (full_name))
        ),
        order:order_id (id, order_number, status, total_amount)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (method)   query = query.eq('method',   method)
    if (category) query = query.eq('category', category)
    if (from)     query = query.gte('created_at', from)
    if (to)       query = query.lte('created_at', to)

    // Map pending_cod to a filterable status
    if (status === 'pending_cod') {
      query = query.eq('status', 'pending_cod')
    } else if (status) {
      query = query.eq('status', status)
    }

    const { data, count, error } = await query
    if (error) throw error

    const enriched = (data || []).map(p => ({
      ...p,
      display_label: p.appointment_id
        ? `Therapy — ${p.appointment?.type || 'session'}`
        : p.order_id
          ? `Order #${p.order?.order_number || p.order_id.slice(0, 8)}`
          : (p.gateway_response?.workshop_id
            ? 'Workshop registration'
            : p.gateway_response?.course_id
              ? 'Course enrollment'
              : 'Direct payment'),
      is_cod: p.method === 'cash' || p.method === 'cod' || p.status === 'pending_cod',
      needs_review: ['pending', 'pending_cod'].includes(p.status),
    }))

    return res.status(200).json({
      success: true,
      payments: enriched,
      pagination: { page: Number(page), limit: Number(limit), total: count || 0 },
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/my-orders  — client: all orders + booking + sessions
// ─────────────────────────────────────────────────────────────────────────────
async function getMyOrders(req, res, next) {
  try {
    const userId = getUserId(req)

    // 1. Store orders
    const { data: orders } = await supabase
      .from('orders')
      .select(`
        id, order_number, status, total_amount, created_at,
        order_items (
          id, quantity, unit_price,
          products (id, name, images, is_digital)
        ),
        payments (id, method, status, paid_at, amount)
      `)
      .eq('client_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    // 2. Appointments
    const { data: appointments } = await supabase
      .from('appointments')
      .select(`
        id, scheduled_at, duration_minutes, type, status, notes, meeting_link, created_at,
        therapist:therapist_id (
          profiles:user_id (full_name, avatar_url)
        ),
        payments (id, method, status, paid_at, amount)
      `)
      .eq('client_id', userId)
      .order('scheduled_at', { ascending: false })
      .limit(50)

    // 3. Course enrollments
    const { data: enrollments } = await supabase
      .from('course_enrollments')
      .select(`
        id, progress, paid, enrolled_at, completed_at,
        courses (id, title, slug, emoji, price, is_free, instructor_id)
      `)
      .eq('user_id', userId)
      .order('enrolled_at', { ascending: false })
      .limit(50)

    // 4. Group session reservations (workshops)
    const { data: reservations } = await supabase
      .from('session_reservations')
      .select(`
        id, status, reserved_at, display_name,
        group_sessions (
          id, title, facilitator, mode, scheduled_at, max_spots, notes,
          community_groups (id, name, emoji)
        )
      `)
      .eq('user_id', userId)
      .order('reserved_at', { ascending: false })
      .limit(50)

    // 5. Pending payments the client needs to know about
    const { data: pendingPayments } = await supabase
      .from('payments')
      .select('id, amount, method, status, category, created_at, gateway_response')
      .eq('client_id', userId)
      .in('status', ['pending', 'pending_cod', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20)

    return res.status(200).json({
      success: true,
      orders:         orders        || [],
      appointments:   appointments  || [],
      enrollments:    enrollments   || [],
      reservations:   reservations  || [],
      pendingPayments: pendingPayments || [],
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments  — client: payment history (existing, unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function getMyPayments(req, res, next) {
  try {
    const userId = getUserId(req)
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    const { data, count, error } = await supabase
      .from('payments')
      .select(
        `id, amount, currency, method, category, status,
         transaction_id, paid_at, created_at, appointment_id, order_id`,
        { count: 'exact' })
      .eq('client_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (error) throw error

    return res.status(200).json({
      success: true,
      payments: data || [],
      pagination: { page: Number(page), limit: Number(limit), total: count || 0 },
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/:id — client: single payment
// ─────────────────────────────────────────────────────────────────────────────
async function getPaymentById(req, res, next) {
  try {
    const userId = getUserId(req)
    const { data, error } = await supabase.from('payments').select('*')
      .eq('id', req.params.id).eq('client_id', userId).single()
    if (error || !data)
      return res.status(404).json({ success: false, message: 'Payment not found.' })
    return res.status(200).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/verify  — self-service verify (still useful for gateways)
// ─────────────────────────────────────────────────────────────────────────────
async function verifyPayment(req, res, next) {
  try {
    const { paymentId, transactionId, gatewayResponse } = req.body
    if (!paymentId)
      return res.status(400).json({ success: false, message: 'paymentId is required.' })

    const { data, error } = await supabase
      .from('payments')
      .update({
        // Keep as pending — admin must still confirm. Only gateways with
        // verified callbacks (eSewa success URL) should auto-complete.
        transaction_id:   transactionId   || null,
        gateway_response: gatewayResponse || null,
      })
      .eq('id', paymentId)
      .select().single()

    if (error) throw error

    return res.status(200).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

module.exports = {
  initiatePayment,
  verifyPayment,
  approvePayment,
  rejectPayment,
  confirmCOD,
  flagCOD,
  getAllPaymentsAdmin,
  getMyPayments,
  getMyOrders,
  getPaymentById,
}