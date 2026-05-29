// src/routes/esewa.js
const express   = require('express')
const crypto    = require('crypto')
const supabase  = require('../db/supabase')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

const ESEWA_SECRET      = process.env.ESEWA_SECRET_KEY        // from eSewa merchant dashboard
const ESEWA_PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE     // e.g. "EPAYTEST" for sandbox
const ESEWA_GATEWAY_URL = process.env.ESEWA_GATEWAY_URL       // "https://rc-epay.esewa.com.np/api/epay/main/v2/form" (sandbox) or prod URL
const APP_URL           = process.env.APP_URL                  // e.g. "https://commonpsychology.com"

function esewaSign(message) {
  return crypto
    .createHmac('sha256', ESEWA_SECRET)
    .update(message)
    .digest('base64')
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/esewa/initiate
// Called by PaymentModal when user clicks "Pay with eSewa".
// Creates a PENDING payment record and returns the signed form fields.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/initiate', authenticate, async (req, res, next) => {
  try {
    const userId = req.user?.sub || req.user?.id
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const { amount, tax_amount = 0, category = 'generic', metadata = {}, coupon_code } = req.body

    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: 'Valid amount required.' })

    const totalAmount   = Math.round(Number(amount))
    const transactionUuid = `CPSY-${Date.now()}-${userId.slice(0, 8)}`

    // 1. Create pending payment row FIRST — before redirect
    const { data: payment, error: insertErr } = await supabase
      .from('payments')
      .insert({
        client_id:        userId,
        amount:           totalAmount,
        currency:         'NPR',
        method:           'esewa',
        category,
        status:           'pending',           // stays pending until eSewa callback
        transaction_id:   transactionUuid,
        appointment_id:   metadata.appointment_id || null,
        order_id:         metadata.order_id       || null,
        gateway_response: { ...metadata, esewa_transaction_uuid: transactionUuid },
        paid_at:          null,
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    // 2. Build signed form fields for eSewa v2
    const signatureMessage =
      `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${ESEWA_PRODUCT_CODE}`
    const signature = esewaSign(signatureMessage)

    const form_fields = {
      amount:           totalAmount,
      tax_amount:       tax_amount,
      total_amount:     totalAmount,
      transaction_uuid: transactionUuid,
      product_code:     ESEWA_PRODUCT_CODE,
      product_service_charge:  0,
      product_delivery_charge: 0,
      success_url: `${APP_URL}/api/esewa/callback/success`,
      failure_url: `${APP_URL}/api/esewa/callback/failure`,
      signed_field_names: 'total_amount,transaction_uuid,product_code',
      signature,
    }

    return res.status(200).json({
      success:      true,
      payment_id:   payment.id,
      redirect_url: ESEWA_GATEWAY_URL,
      form_fields,
    })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/esewa/callback/success
// eSewa redirects here after successful payment.
// Verifies signature, marks payment completed, cascades to order/appointment.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback/success', async (req, res, next) => {
  try {
    // eSewa v2 sends: data (base64-encoded JSON)
    const { data: encodedData } = req.query

    if (!encodedData) {
      console.error('[eSewa callback] No data param received')
      return res.redirect(`${APP_URL}/payment/failed?reason=no_data`)
    }

    // Decode the base64 payload
    let esewaData
    try {
      esewaData = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8'))
    } catch {
      return res.redirect(`${APP_URL}/payment/failed?reason=decode_error`)
    }

    const {
      transaction_uuid,
      status,
      total_amount,
      transaction_code,
      signed_field_names,
      signature: receivedSignature,
    } = esewaData

    // 1. Verify status
    if (status !== 'COMPLETE') {
      return res.redirect(`${APP_URL}/payment/failed?reason=not_complete&ref=${transaction_uuid}`)
    }

    // 2. Verify signature — CRITICAL, never skip
    const fieldsToSign = signed_field_names.split(',')
    const signatureMessage = fieldsToSign
      .map(f => `${f}=${esewaData[f]}`)
      .join(',')
    const expectedSignature = esewaSign(signatureMessage)

    if (expectedSignature !== receivedSignature) {
      console.error('[eSewa callback] Signature mismatch', { expected: expectedSignature, received: receivedSignature })
      return res.redirect(`${APP_URL}/payment/failed?reason=signature_mismatch`)
    }

    // 3. Find the pending payment by transaction_uuid
    const { data: payment, error: fetchErr } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', transaction_uuid)
      .single()

    if (fetchErr || !payment) {
      console.error('[eSewa callback] Payment not found for uuid:', transaction_uuid)
      return res.redirect(`${APP_URL}/payment/failed?reason=not_found`)
    }

    // 4. Idempotency — don't double-complete
    if (payment.status === 'completed') {
      return res.redirect(`${APP_URL}/payment/success?ref=${transaction_uuid}`)
    }

    // 5. Mark completed — NOW and only now
    const { error: updateErr } = await supabase
      .from('payments')
      .update({
        status:     'completed',
        paid_at:    new Date().toISOString(),
        gateway_response: {
          ...(payment.gateway_response || {}),
          esewa_transaction_code: transaction_code,
          esewa_total_amount:     total_amount,
          esewa_status:           status,
          esewa_raw:              esewaData,
          confirmed_at:           new Date().toISOString(),
        },
      })
      .eq('id', payment.id)

    if (updateErr) throw updateErr

    // 6. Cascade to linked records
    if (payment.appointment_id) {
      await supabase.from('appointments')
        .update({ status: 'confirmed', payment_status: 'paid' })
        .eq('id', payment.appointment_id)
    }

    if (payment.order_id) {
      await supabase.from('orders')
        .update({ status: 'confirmed' })
        .eq('id', payment.order_id)
        .in('status', ['pending'])
    }

    // 7. Notify client
    await supabase.from('notifications').insert({
      user_id: payment.client_id,
      title:   '✅ eSewa Payment Confirmed!',
      message: `Your payment of NPR ${Number(payment.amount).toLocaleString()} via eSewa has been confirmed.`,
      type:    'payment',
      link:    '/portal',
      is_read: false,
    }).catch(() => {})

    // 8. Redirect to success page
    return res.redirect(`${APP_URL}/payment/success?ref=${transaction_uuid}&method=esewa`)

  } catch (err) {
    console.error('[eSewa callback] Error:', err)
    return res.redirect(`${APP_URL}/payment/failed?reason=server_error`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/esewa/callback/failure
// eSewa redirects here if user cancels or payment fails.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback/failure', async (req, res) => {
  const { data: encodedData } = req.query
  if (encodedData) {
    try {
      const esewaData = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8'))
      const { transaction_uuid } = esewaData
      if (transaction_uuid) {
        await supabase.from('payments')
          .update({ status: 'failed' })
          .eq('transaction_id', transaction_uuid)
          .eq('status', 'pending')   // only update if still pending
      }
    } catch {}
  }
  return res.redirect(`${APP_URL}/payment/failed?reason=cancelled`)
})

module.exports = router