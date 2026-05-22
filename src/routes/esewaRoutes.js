// ============================================================
//  esewaRoutes.js  —  Complete eSewa ePay v2 Backend
//  Place this file at:  server/routes/esewaRoutes.js
//  (or wherever your Express routes live)
// ============================================================
//
//  ENDPOINTS THIS FILE PROVIDES:
//   POST  /api/esewa/initiate   — Create pending payment + return signed form data
//   GET   /api/esewa/verify     — eSewa calls this on success  (success_url)
//   GET   /api/esewa/failure    — eSewa calls this on failure  (failure_url)
//   GET   /api/esewa/status/:txnUuid  — Manual status check (admin/debug)
//
// ============================================================

const express  = require('express')
const crypto   = require('crypto')
const router   = express.Router()

// ── YOUR DB IMPORT ────────────────────────────────────────────
// Replace this with however you access your database.
// Examples shown for Supabase (JS client) and raw pg/knex.
// The logic is the same regardless of your ORM.
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role = bypasses RLS
)

// ── ENV VARIABLES REQUIRED (add to your .env) ────────────────
//   ESEWA_MERCHANT_ID   = EPAYTEST              (test)  / your real merchant code (live)
//   ESEWA_SECRET_KEY    = 8gBm/:&EnhH.1/q       (test)  / your real secret key   (live)
//   ESEWA_ENV           = test                  or  live
//   FRONTEND_URL        = http://localhost:5173  (test)  / https://yoursite.com   (live)
//   SUPABASE_URL        = https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = eyJ...

const IS_LIVE        = process.env.ESEWA_ENV === 'live'
const MERCHANT_ID    = process.env.ESEWA_MERCHANT_ID   || 'EPAYTEST'
const SECRET_KEY     = process.env.ESEWA_SECRET_KEY    || '8gBm/:&EnhH.1/q'
const FRONTEND_URL   = process.env.FRONTEND_URL        || 'https://commonpsychology.vercel.app'

// eSewa official URLs
const ESEWA_FORM_URL = IS_LIVE
  ? 'https://epay.esewa.com.np/api/epay/main/v2/form'
  : 'https://rc-epay.esewa.com.np/api/epay/main/v2/form'

const ESEWA_STATUS_URL = IS_LIVE
  ? 'https://epay.esewa.com.np/api/epay/transaction/status/'
  : 'https://rc.esewa.com.np/api/epay/transaction/status/'

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
// Adjust to match your existing auth middleware name/export.
// Your middleware should set req.user = { id, email, ... }
const { authenticate: requireAuth } = require('../middleware/auth')
// ── HELPER: Generate HMAC-SHA256 Signature ───────────────────
function generateSignature(totalAmount, transactionUuid, productCode) {
  // eSewa requires exactly this string format — order matters!
  const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(message)
    .digest('base64')
}

// ── HELPER: Verify Signature from eSewa callback ─────────────
function verifyCallbackSignature(decodedData) {
  const { signed_field_names, signature } = decodedData
  if (!signed_field_names || !signature) return false

  const fields       = signed_field_names.split(',')
  const signInput    = fields.map(f => `${f}=${decodedData[f]}`).join(',')
  const expected     = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(signInput)
    .digest('base64')

  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    )
  } catch {
    return false
  }
}

// ── HELPER: Generate unique transaction UUID ──────────────────
function generateTxnUuid(userId) {
  // eSewa only allows alphanumeric + hyphen. Max ~50 chars.
  const ts   = Date.now()
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase()
  return `TXN-${ts}-${rand}`
}

// ── HELPER: Call eSewa Status API to double-verify ───────────
async function verifyWithEsewa(transactionUuid, totalAmount) {
  const url = `${ESEWA_STATUS_URL}?product_code=${MERCHANT_ID}&transaction_uuid=${transactionUuid}&total_amount=${totalAmount}`
  const res  = await fetch(url, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`eSewa status API returned ${res.status}`)
  return await res.json()
  // Returns: { product_code, transaction_uuid, total_amount, status, ref_id }
  // status === 'COMPLETE' means verified
}

async function handlePaymentSuccess(payment) {
  // appointment_id and order_id are direct columns now, not in metadata
  if (payment.appointment_id) {
    await supabase
      .from('appointments')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', payment.appointment_id)
  }

  if (payment.order_id) {
    await supabase
      .from('orders')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', payment.order_id)
  }

  // notification
  try {
    await supabase.from('notifications').insert({
      user_id: payment.client_id,
      type:    'payment',
      title:   '✅ Payment Confirmed',
      message: `Your payment of NPR ${Number(payment.amount).toLocaleString()} via eSewa has been verified.`,
      is_read: false,
    })
  } catch (e) {
    console.warn('[eSewa] Notification failed (non-fatal):', e.message)
  }
}

// ════════════════════════════════════════════════════════════
//  ROUTE 1 — POST /api/esewa/initiate
//  Called by frontend PaymentModal when user clicks Pay with eSewa
// ════════════════════════════════════════════════════════════
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    const {
      amount,           // Number — base amount in NPR (before tax)
      tax_amount,       // Number — tax, usually 0
      category,         // String — 'appointment' | 'order' | 'course' | etc.
      metadata,         // Object — { appointment_id, order_id, etc. }
      coupon_code,      // String | undefined
    } = req.body

    // ── Validation ────────────────────────────────────────
    const baseAmount = Math.round(Number(amount) || 0)
    const taxAmt     = Math.round(Number(tax_amount) || 0)
    const totalAmt   = baseAmount + taxAmt

    if (totalAmt <= 0) {
      return res.status(400).json({ message: 'Invalid amount. Must be greater than 0.' })
    }
    if (!category) {
      return res.status(400).json({ message: 'Payment category is required.' })
    }

    // ── Apply coupon if provided ───────────────────────────
    let finalAmount = totalAmt
    let couponData  = null
    if (coupon_code) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', coupon_code.toUpperCase())
        .eq('is_active', true)
        .single()

      if (coupon) {
        const discount = coupon.type === 'percentage'
          ? Math.round(totalAmt * coupon.value / 100)
          : coupon.value
        finalAmount = Math.max(0, totalAmt - discount)
        couponData  = coupon
      }
    }

    // ── Generate unique transaction UUID ──────────────────
    const transactionUuid = generateTxnUuid(req.user.id)

    const { data: payment, error: insertErr } = await supabase
  .from('payments')
  .insert({
    client_id:      req.user.id,
    amount:         finalAmount,
    method:         'esewa',
    status:         'pending',
    currency:       'NPR',
    category:       category,
    transaction_id: transactionUuid,
    // link to appointment/order if provided in metadata
    appointment_id: metadata?.appointment_id || null,
    order_id:       metadata?.order_id       || null,
    room_booking_id:metadata?.room_booking_id|| null,
    coupon_id:      couponData?.id           || null,
  })
  .select()
  .single()
    if (insertErr) throw new Error('Failed to create payment record: ' + insertErr.message)

    // ── Generate HMAC signature ───────────────────────────
    const signature = generateSignature(finalAmount, transactionUuid, MERCHANT_ID)

    console.log('[eSewa initiate] form_fields:', {
  total_amount:     String(finalAmount),
  transaction_uuid: transactionUuid,
  product_code:     MERCHANT_ID,
  signature:        signature,
  secret_used:      SECRET_KEY,
})

    // ── Return signed form data to frontend ──────────────
    return res.json({
      payment_id:   payment.id,
      redirect_url: ESEWA_FORM_URL,

      // These fields go into the hidden HTML form
      form_fields: {
        amount:                   String(finalAmount),   // base (no tax in our case)
        tax_amount:               '0',
        total_amount:             String(finalAmount),   // total = amount + tax
        transaction_uuid:         transactionUuid,
        product_code:             MERCHANT_ID,
        product_service_charge:   '0',
        product_delivery_charge:  '0',
        success_url: `${FRONTEND_URL}/payment/esewa/success`,
        failure_url: `${FRONTEND_URL}/payment/esewa/failure`,
        signed_field_names:       'total_amount,transaction_uuid,product_code',
        signature:                signature,
      },
    })

  } catch (err) {
    console.error('[eSewa /initiate] Error:', err)
    return res.status(500).json({ message: err.message || 'Server error' })
  }
})

// ════════════════════════════════════════════════════════════
//  ROUTE 2 — GET /api/esewa/verify
//  eSewa redirects here after SUCCESSFUL payment
//  URL will be: /api/esewa/verify?data=BASE64_ENCODED_JSON
//
//  NOTE: This is called server-side by our success page — NOT
//  directly by eSewa. Our frontend success page receives
//  the ?data= param and calls this endpoint.
// ════════════════════════════════════════════════════════════
router.get('/verify', requireAuth, async (req, res) => {
  try {
    const { data: rawData } = req.query

    if (!rawData) {
      return res.status(400).json({ success: false, message: 'No data parameter received.' })
    }

    // ── Step 1: Decode base64 JSON from eSewa ────────────
    let decoded
    try {
      decoded = JSON.parse(Buffer.from(rawData, 'base64').toString('utf8'))
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid data encoding.' })
    }

    console.log('[eSewa verify] Decoded callback:', decoded)

    const { transaction_uuid, total_amount, status } = decoded

    // ── Step 2: Verify HMAC signature ────────────────────
    const sigValid = verifyCallbackSignature(decoded)
    if (!sigValid) {
      console.error('[eSewa verify] SIGNATURE MISMATCH — possible tamper attempt')
      return res.status(400).json({ success: false, message: 'Signature verification failed.' })
    }

    // ── Step 3: Check eSewa reported status ──────────────
    if (status !== 'COMPLETE') {
      return res.status(400).json({
        success: false,
        message: `Payment not complete. eSewa status: ${status}`,
      })
    }

    // ── Step 4: Find our payment record ──────────────────
    const { data: payment, error: findErr } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', transaction_uuid)
      .single()

    if (findErr || !payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' })
    }

    // ── Step 5: Idempotency — already confirmed? ─────────
    if (payment.status === 'completed') {
      return res.json({
        success:        true,
        already_done:   true,
        payment_id:     payment.id,
        transaction_id: transaction_uuid,
        message:        'Already verified.',
      })
    }

    // ── Step 6: Double-verify with eSewa Status API ──────
    let esewaVerification
    try {
      esewaVerification = await verifyWithEsewa(transaction_uuid, total_amount)
      if (esewaVerification.status !== 'COMPLETE') {
        return res.status(400).json({
          success: false,
          message: `eSewa API status check: ${esewaVerification.status}`,
        })
      }
    } catch (verifyErr) {
      // If eSewa's status API is down, trust the signature (fail-open for UX)
      console.warn('[eSewa verify] Status API failed (non-fatal):', verifyErr.message)
    }

    // ── Step 7: Mark payment as COMPLETED ────────────────
    const { error: updateErr } = await supabase
      .from('payments')
      .update({
        status:           'completed',
        paid_at:          new Date().toISOString(),
        gateway_response: {
          esewa_decoded:  decoded,
          esewa_status:   esewaVerification || null,
        },
      })
      .eq('id', payment.id)

    if (updateErr) throw new Error('Failed to update payment: ' + updateErr.message)

    // ── Step 8: Trigger downstream confirmations ─────────
    await handlePaymentSuccess(payment)

    console.log(`[eSewa verify] ✅ Payment ${payment.id} confirmed. TXN: ${transaction_uuid}`)

    return res.json({
      success:        true,
      payment_id:     payment.id,
      transaction_id: transaction_uuid,
      amount:         payment.amount,
      category:       payment.category,
      message:        'Payment verified and confirmed.',
    })

  } catch (err) {
    console.error('[eSewa /verify] Error:', err)
    return res.status(500).json({ success: false, message: err.message || 'Verification error.' })
  }
})

// ════════════════════════════════════════════════════════════
//  ROUTE 3 — GET /api/esewa/failure
//  Called by our failure page when eSewa redirects to failure_url
// ════════════════════════════════════════════════════════════
router.get('/failure', async (req, res) => {
  // eSewa may not always include a ?data= param on failure.
  // We just log and return a response the frontend can use.
  console.log('[eSewa /failure] Payment failed/cancelled. Query:', req.query)

  // Try to find and mark the payment failed if we have a transaction_uuid
  const { data: rawData } = req.query
  if (rawData) {
    try {
      const decoded = JSON.parse(Buffer.from(rawData, 'base64').toString('utf8'))
      if (decoded.transaction_uuid) {
        await supabase
          .from('payments')
          .update({ status: 'failed' })
          .eq('transaction_id', decoded.transaction_uuid)
          .eq('status', 'pending')    // only update if still pending
      }
    } catch { /* ignore decode errors on failure path */ }
  }

  return res.json({ success: false, message: 'Payment was not completed.' })
})

// ════════════════════════════════════════════════════════════
//  ROUTE 4 — GET /api/esewa/status/:txnUuid
//  Admin/debug endpoint to manually check any transaction
// ════════════════════════════════════════════════════════════
router.get('/status/:txnUuid', requireAuth, async (req, res) => {
  try {
    const { txnUuid } = req.params

    // Get from our DB
    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', txnUuid)
      .single()

    if (!payment) return res.status(404).json({ message: 'Not found' })

    // Also ping eSewa (optional, for debug)
    let esewaStatus = null
    try {
      esewaStatus = await verifyWithEsewa(txnUuid, payment.amount)
    } catch (e) {
      esewaStatus = { error: e.message }
    }

    return res.json({ our_record: payment, esewa_status: esewaStatus })
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

module.exports = router