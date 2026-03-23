// src/routes/controllers/paymentController.js
const supabase = require('../../db/supabase')

async function initiatePayment(req, res, next) {
  try {
    const userId = req.user?.id
    const { appointmentId, orderId, amount, currency = 'NPR', method, status = 'pending', transactionId, gatewayResponse } = req.body
    if (!amount || !method)
      return res.status(400).json({ success: false, message: 'amount and method are required.' })
    const { data, error } = await supabase.from('payments').insert({
      client_id:        userId,
      appointment_id:   appointmentId || null,
      order_id:         orderId       || null,
      amount:           Number(amount),
      currency, method, status,
      transaction_id:   transactionId  || null,
      gateway_response: gatewayResponse || null,
      paid_at:          status === 'completed' ? new Date().toISOString() : null,
    }).select().single()
    if (error) throw error
    return res.status(201).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

async function verifyPayment(req, res, next) {
  try {
    const { paymentId, transactionId, gatewayResponse } = req.body
    if (!paymentId)
      return res.status(400).json({ success: false, message: 'paymentId is required.' })
    const { data, error } = await supabase.from('payments')
      .update({ status: 'completed', transaction_id: transactionId || null, gateway_response: gatewayResponse || null, paid_at: new Date().toISOString() })
      .eq('id', paymentId).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

async function getMyPayments(req, res, next) {
  try {
    const userId = req.user?.id
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    const { data, count, error } = await supabase.from('payments')
      .select('id, amount, currency, method, status, transaction_id, paid_at, created_at', { count: 'exact' })
      .eq('client_id', userId).order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (error) throw error
    return res.status(200).json({ success: true, payments: data || [], pagination: { page: Number(page), limit: Number(limit), total: count || 0 } })
  } catch (err) { next(err) }
}

async function getPaymentById(req, res, next) {
  try {
    const userId = req.user?.id
    const { data, error } = await supabase.from('payments').select('*')
      .eq('id', req.params.id).eq('client_id', userId).single()
    if (error || !data) return res.status(404).json({ success: false, message: 'Payment not found.' })
    return res.status(200).json({ success: true, payment: data })
  } catch (err) { next(err) }
}

module.exports = { initiatePayment, verifyPayment, getMyPayments, getPaymentById }