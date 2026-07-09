// src/routes/controllers/paymentConfirmationController.js
const supabase = require('../../db/supabase')

const getUserId = (req) => req.user?.sub || req.user?.id

async function sendNotification(userId, { title, message, type = 'payment', link = null }) {
  await supabase.from('notifications').insert({
    user_id: userId, title, message, type, link, is_read: false,
  })
}

async function logAudit(actorId, action, tableN, recordId, newData = {}) {
  await supabase.from('audit_logs').insert({
    actor_id: actorId, action, table_name: tableN,
    record_id: recordId, new_data: newData,
  }).catch(() => {})
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coupons/validate
// ─────────────────────────────────────────────────────────────────────────────
async function validateCoupon(req, res, next) {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const { code, amount } = req.body
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code is required.' })

    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .single()

    if (error || !coupon)
      return res.status(404).json({ success: false, message: 'Coupon not found.' })

    if (coupon.used_by)
      return res.status(400).json({
        success: false,
        message: 'This coupon has already been claimed.',
        alreadyClaimed: true,
        claimedAt: coupon.used_at,
      })

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
      return res.status(400).json({ success: false, message: 'This coupon has expired.' })

    if (amount && coupon.min_amount && Number(amount) < Number(coupon.min_amount))
      return res.status(400).json({
        success: false,
        message: `This coupon requires a minimum order of NPR ${Number(coupon.min_amount).toLocaleString()}.`,
      })

    const baseAmount = Number(amount) || 0
    const discount = coupon.type === 'percentage'
      ? Math.round(baseAmount * coupon.value / 100)
      : Number(coupon.value)

    return res.status(200).json({
      success: true,
      coupon: {
        id:    coupon.id,
        code:  coupon.code,
        type:  coupon.type,
        value: coupon.value,
      },
      discount,
      finalAmount: Math.max(0, baseAmount - discount),
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loyalty discount: every 10th completed payment unlocks 20% off the NEXT one
// (i.e. after 10, 20, 30... completed payments → the 11th, 21st, 31st... gets 20% off)
// ─────────────────────────────────────────────────────────────────────────────
async function getClientLoyaltyStatus(userId) {
  const { count, error } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', userId)
    .eq('status', 'completed')

  if (error) throw error

  const completedCount        = count || 0
  const upcomingPaymentNumber = completedCount + 1
  const isEligible             = completedCount > 0 && completedCount % 10 === 0

  return { completedCount, upcomingPaymentNumber, isEligible }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/loyalty-status
// Lets the frontend preview the discount before the client confirms payment.
// ─────────────────────────────────────────────────────────────────────────────
async function getLoyaltyStatus(req, res, next) {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const status = await getClientLoyaltyStatus(userId)
    return res.status(200).json({ success: true, ...status })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/initiate  &  POST /api/payments
// ─────────────────────────────────────────────────────────────────────────────
async function initiatePayment(req, res, next) {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const {
      appointment_id, appointmentId,   // ← accept both
      order_id,       orderId,         // ← accept both
      amount, currency = 'NPR',
      method, transactionId, gatewayResponse,
      workshopId, courseId, referenceCode, notes,
      coupon_code, couponCode,
    } = req.body

    // ✅ FIX: single source of truth used EVERYWHERE below, no more mixing
    // the normalized var with the raw destructured one.
    const apptId   = appointment_id || appointmentId || null
    const orderIdN = order_id       || orderId       || null

    if (!amount || !method)
      return res.status(400).json({ success: false, message: 'amount and method are required.' })

    let couponId       = null
    let discountAmount = 0
    let finalAmount    = Math.round(Number(amount))

    // ── Coupon claiming (atomic) ──────────────────────────────────────────
    const rawCode = (coupon_code || couponCode || '').trim().toUpperCase()
    if (rawCode) {
      const { data: coupon, error: couponFetchErr } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', rawCode)
        .single()

      if (couponFetchErr || !coupon)
        return res.status(400).json({ success: false, message: 'Coupon not found.' })

      if (coupon.used_by)
        return res.status(400).json({
          success: false,
          message: 'Sorry! This coupon was just claimed by another customer.',
          alreadyClaimed: true,
        })

      if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
        return res.status(400).json({ success: false, message: 'Coupon has expired.' })

      const { data: claimed, error: claimErr } = await supabase
        .from('coupons')
        .update({ used_by: userId, used_at: new Date().toISOString() })
        .eq('id', coupon.id)
        .is('used_by', null)
        .select()
        .single()

      if (claimErr || !claimed)
        return res.status(400).json({
          success: false,
          message: 'This coupon was just claimed by another customer. Better luck next time!',
          alreadyClaimed: true,
        })

   discountAmount = coupon.type === 'percentage'
        ? Math.round(Number(amount) * coupon.value / 100)
        : Number(coupon.value)

      finalAmount = Math.max(0, Math.round(Number(amount)) - discountAmount)
      couponId    = coupon.id
    }

    // ── Loyalty discount (applies AFTER coupon, on the remaining amount) ──
    let loyaltyApplied        = false
    let loyaltyDiscountAmount = 0
    let loyaltyPaymentNumber  = null

    const loyalty = await getClientLoyaltyStatus(userId)
    if (loyalty.isEligible) {
      loyaltyDiscountAmount = Math.round(finalAmount * 0.20)
      finalAmount           = Math.max(0, finalAmount - loyaltyDiscountAmount)
      loyaltyApplied        = true
      loyaltyPaymentNumber  = loyalty.upcomingPaymentNumber
    }

    const category = apptId ? 'appointment' : orderIdN ? 'order' : 'other'

    const initialStatus = method === 'cash' || method === 'cod'
      ? 'pending_cod'
      : 'pending'

    const metadata = {}
    if (workshopId)    metadata.workshop_id    = workshopId
    if (courseId)      metadata.course_id      = courseId
    if (referenceCode) metadata.reference_code = referenceCode
    if (notes)         metadata.notes          = notes
if (discountAmount > 0) {
      metadata.original_amount = Math.round(Number(amount))
      metadata.discount_amount = discountAmount
      metadata.coupon_code     = rawCode
    }
    if (loyaltyApplied) {
      metadata.loyalty_discount_applied = true
      metadata.loyalty_discount_amount  = loyaltyDiscountAmount
      metadata.loyalty_payment_number   = loyaltyPaymentNumber
    }

    const insertPayload = {
      client_id:        userId,
      appointment_id:   apptId,
      order_id:         orderIdN,
      coupon_id:        couponId,
      amount:           finalAmount,
      currency,
      method,
      category,
      status:           initialStatus,
      transaction_id:   transactionId || null,
      gateway_response: gatewayResponse
        ? (typeof gatewayResponse === 'string' ? JSON.parse(gatewayResponse) : gatewayResponse)
        : (Object.keys(metadata).length ? metadata : null),
      paid_at: null,
    }

    const { data, error } = await supabase
      .from('payments').insert(insertPayload).select().single()

    if (error) throw error

    // ✅ FIX: use apptId (normalized), not the raw appointmentId variable.
    // This is the line that was silently no-op'ing whenever the caller sent
    // snake_case appointment_id.
if (apptId) {
      await supabase.from('appointments')
        .update({ payment_status: 'pending' })
        .eq('id', apptId)
        .eq('payment_status', 'unpaid')
    }

    // Notify client specifically about the loyalty reward
    if (loyaltyApplied) {
      await sendNotification(userId, {
        title:   '🎉 Loyalty Reward Unlocked!',
        message: `This is your ${loyaltyPaymentNumber}th payment with us — enjoy 20% off (NPR ${loyaltyDiscountAmount.toLocaleString()} saved)!`,
        type:    'payment',
        link:    '/portal',
      })
    }

    // Notify admin of new pending payment (QR / digital wallet)
    if (method !== 'cash' && method !== 'cod') {
      const adminProfiles = await supabase
        .from('profiles').select('id').eq('role', 'admin')
      for (const admin of (adminProfiles.data || [])) {
        await sendNotification(admin.id, {
          title:   `New pending payment — NPR ${Number(finalAmount).toLocaleString()}`,
          message: `Method: ${method}. Txn: ${transactionId || 'not provided'}.${rawCode ? ` Coupon: ${rawCode}.` : ''}${loyaltyApplied ? ` Loyalty 20% applied (payment #${loyaltyPaymentNumber}).` : ''}`,
          type:    'payment',
          link:    '/staff/admin?tab=payments',
        })
      }
    }

    return res.status(201).json({
      success: true,
      payment: data,
      ...(discountAmount > 0 && {
        couponApplied: true,
        discountAmount,
        originalAmount: Math.round(Number(amount)),
      }),
      ...(loyaltyApplied && {
        loyaltyDiscountApplied: true,
        loyaltyDiscountAmount,
        loyaltyPaymentNumber,
        loyaltyMessage: `🎉 This is your ${loyaltyPaymentNumber}th payment — 20% loyalty discount applied!`,
      }),
      finalAmount,
    })
  } catch (err) { next(err) }
}

// ─── All other functions ───────────────────────────────────────────

async function approvePayment(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { transactionId, adminNote } = req.body

    const { data: payment, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', id).single()
    if (fetchErr || !payment)
      return res.status(404).json({ success: false, message: 'Payment not found.' })
    if (payment.status === 'completed')
      return res.status(400).json({ success: false, message: 'Payment already completed.' })

    const updatePayload = {
      status:         'completed',
      paid_at:        new Date().toISOString(),
      transaction_id: transactionId || payment.transaction_id,
      gateway_response: {
        ...(payment.gateway_response || {}),
        admin_approved_by: adminId,
        admin_approved_at: new Date().toISOString(),
        admin_note:        adminNote || null,
      },
    }

    const { data: updated, error: updateErr } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (updateErr) throw updateErr

    if (payment.appointment_id) {
      await supabase.from('appointments')
        .update({ status: 'confirmed', payment_status: 'paid' })
        .eq('id', payment.appointment_id)
        .in('status', ['pending'])
    }
    if (payment.order_id) {
      await supabase.from('orders')
        .update({ status: 'confirmed' })
        .eq('id', payment.order_id)
        .in('status', ['pending'])
    }

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

    if (payment.appointment_id) {
      await supabase.from('appointments')
        .update({ payment_status: 'unpaid' })
        .eq('id', payment.appointment_id)
    }
    if (payment.coupon_id) {
      await supabase.from('coupons')
        .update({ used_by: null, used_at: null })
        .eq('id', payment.coupon_id)
    }

    await sendNotification(payment.client_id, {
      title:   '❌ Payment Not Verified',
      message: `Your payment of NPR ${Number(payment.amount).toLocaleString()} could not be verified. Reason: ${reason || 'Please contact us.'}`,
      type:    'payment',
      link:    '/contact',
    })

    await logAudit(adminId, 'PAYMENT_REJECTED', 'payments', id, updatePayload)
    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}

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

    if (payment.appointment_id) {
      await supabase.from('appointments')
        .update({ status: 'confirmed', payment_status: 'paid' })
        .eq('id', payment.appointment_id)
        .in('status', ['pending'])
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
        cod_flagged_by:  adminId,
        cod_flagged_at:  new Date().toISOString(),
        cod_flag_reason: reason || 'Client refused payment on delivery.',
      },
    }

    const { data: updated, error } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (error) throw error

    if (payment.coupon_id) {
      await supabase.from('coupons')
        .update({ used_by: null, used_at: null })
        .eq('id', payment.coupon_id)
    }

    // ✅ FIX: flagCOD previously left the appointment stuck at
    // payment_status:'pending' forever. Now it resets like rejectPayment does.
    if (payment.appointment_id) {
      await supabase.from('appointments')
        .update({ payment_status: 'unpaid' })
        .eq('id', payment.appointment_id)
    }

    if (payment.order_id) {
      await supabase.from('orders')
        .update({ status: 'cancelled', notes: `COD refused: ${reason || 'client refused'}` })
        .eq('id', payment.order_id)
    }

    await sendNotification(payment.client_id, {
      title:   '⚠️ COD Order Issue',
      message: 'Your cash-on-delivery order could not be completed. Please contact us to resolve this.',
      type:    'payment',
      link:    '/contact',
    })

    await logAudit(adminId, 'COD_FLAGGED', 'payments', id, updatePayload)
    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}

async function getAllPaymentsAdmin(req, res, next) {
  try {
    const { page = 1, limit = 20, method, status, category, from, to } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('payments')
      .select(`
        id, amount, currency, method, category, status,
        transaction_id, paid_at, created_at,
        appointment_id, order_id, gateway_response, coupon_id,
        client:client_id (id, full_name, email, phone),
        coupon:coupon_id (code, type, value),
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
      is_cod:        p.method === 'cash' || p.method === 'cod' || p.status === 'pending_cod',
      needs_review:  ['pending', 'pending_cod'].includes(p.status),
    }))

    return res.status(200).json({
      success: true,
      payments: enriched,
      pagination: { page: Number(page), limit: Number(limit), total: count || 0 },
    })
  } catch (err) { next(err) }
}

async function getMyOrders(req, res, next) {
  try {
    const userId = getUserId(req)

    const { data: orders } = await supabase
      .from('orders')
      .select(`
        id, order_number, status, total_amount, created_at,
        order_items (
          id, quantity, unit_price,
          products (id, name, images, is_digital)
        ),
        payments (id, method, status, paid_at, amount, coupon_id,
          coupon:coupon_id (code, type, value))
      `)
      .eq('client_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    const { data: appointments } = await supabase
      .from('appointments')
      .select(`
        id, scheduled_at, duration_minutes, type, status, notes, meeting_link, created_at,
        therapist:therapist_id (
          profiles:user_id (full_name, avatar_url)
        ),
        payments (id, method, status, paid_at, amount, coupon_id,
          coupon:coupon_id (code, type, value))
      `)
      .eq('client_id', userId)
      .order('scheduled_at', { ascending: false })
      .limit(50)

    const { data: enrollments } = await supabase
      .from('course_enrollments')
      .select(`
        id, progress, paid, enrolled_at, completed_at,
        courses (id, title, slug, emoji, price, is_free, instructor_id)
      `)
      .eq('user_id', userId)
      .order('enrolled_at', { ascending: false })
      .limit(50)

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

    const { data: pendingPayments } = await supabase
      .from('payments')
      .select('id, amount, method, status, category, created_at, gateway_response, coupon_id')
      .eq('client_id', userId)
      .in('status', ['pending', 'pending_cod', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20)

    return res.status(200).json({
      success: true,
      orders:          orders          || [],
      appointments:    appointments    || [],
      enrollments:     enrollments     || [],
      reservations:    reservations    || [],
      pendingPayments: pendingPayments || [],
    })
  } catch (err) { next(err) }
}

async function getMyPayments(req, res, next) {
  try {
    const userId = getUserId(req)
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    const { data, count, error } = await supabase
      .from('payments')
      .select(
        `id, amount, currency, method, category, status,
         transaction_id, paid_at, created_at, appointment_id, order_id, coupon_id,
         coupon:coupon_id (code, type, value)`,
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

async function verifyPayment(req, res, next) {
  try {
    const { paymentId, transactionId, gatewayResponse } = req.body
    if (!paymentId)
      return res.status(400).json({ success: false, message: 'paymentId is required.' })

    const { data, error } = await supabase
      .from('payments')
      .update({
        transaction_id:   transactionId   || null,
        gateway_response: gatewayResponse || null,
      })
      .eq('id', paymentId)
      .select().single()

    if (error) throw error
    return res.status(200).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

async function updatePaymentStatus(req, res, next) {
  try {
    const adminId = getUserId(req)
    const { id }  = req.params
    const { status } = req.body

    const ALLOWED = ['pending', 'completed', 'failed', 'refunded']
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${ALLOWED.join(', ')}`,
      })
    }

    const { data: payment, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', id).single()
    if (fetchErr || !payment)
      return res.status(404).json({ success: false, message: 'Payment not found.' })

    if (payment.status === status)
      return res.status(200).json({ success: true, payment })

    const updatePayload = {
      status,
      ...(status === 'completed' ? { paid_at: new Date().toISOString() } : {}),
      gateway_response: {
        ...(payment.gateway_response || {}),
        status_updated_by: adminId,
        status_updated_at: new Date().toISOString(),
      },
    }

    const { data: updated, error: updateErr } = await supabase
      .from('payments').update(updatePayload).eq('id', id).select().single()
    if (updateErr) throw updateErr

    const apptPaymentStatus = {
      completed: 'paid',
      failed:    'failed',
      refunded:  'refunded',
      pending:   'pending',
    }[status]

    if (payment.appointment_id && apptPaymentStatus) {
      const apptUpdate = { payment_status: apptPaymentStatus }
      if (status === 'completed') apptUpdate.status = 'confirmed'
      await supabase.from('appointments')
        .update(apptUpdate)
        .eq('id', payment.appointment_id)
    }

    if (payment.order_id && status === 'completed') {
      await supabase.from('orders')
        .update({ status: 'confirmed' })
        .eq('id', payment.order_id)
        .in('status', ['pending'])
    }

    if (['failed', 'refunded'].includes(status) && payment.coupon_id) {
      await supabase.from('coupons')
        .update({ used_by: null, used_at: null })
        .eq('id', payment.coupon_id)
    }

    if (status === 'completed') {
      await sendNotification(payment.client_id, {
        title:   '✅ Payment Confirmed!',
        message: `Your payment of NPR ${Number(payment.amount).toLocaleString()} via ${payment.method} has been verified.`,
        type:    'payment',
        link:    '/portal',
      })
    }

    await logAudit(adminId, 'PAYMENT_STATUS_UPDATED', 'payments', id, updatePayload)

    return res.status(200).json({ success: true, payment: updated })
  } catch (err) { next(err) }
}
module.exports = {
  initiatePayment,
  verifyPayment,
  validateCoupon,
  getLoyaltyStatus,
  approvePayment,
  rejectPayment,
  updatePaymentStatus,
  confirmCOD,
  flagCOD,
  getAllPaymentsAdmin,
  getMyPayments,
  getMyOrders,
  getPaymentById,
}