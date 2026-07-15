const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')
const { sendNotificationEmail } = require('../services/mailer')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const RIDER_ALLOWED_STATUSES = ['picked_up', 'in_transit', 'delivered', 'failed', 'returned']

const OTP_TTL_MINUTES = 10

function generateOtp() {
  // 6-digit numeric code, zero-padded
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

// ---------- POST /api/delivery/check-credentials ----------
// Step 1 of login: verify email + password only. Does NOT issue a token.
// Returns minimal user info the frontend needs to kick off the OTP step.
exports.checkCredentials = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }

    const { data: rider, error } = await supabase
      .from('delivery_riders')
      .select('id, email, phone, full_name, password_hash, is_active')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()

    // Same generic message whether the rider doesn't exist or password is wrong —
    // avoids leaking which emails are registered.
    if (error || !rider) return res.status(401).json({ message: 'Invalid email or password.' })
    if (!rider.is_active) return res.status(403).json({ message: 'Your account is deactivated. Contact admin.' })

    const ok = await bcrypt.compare(password, rider.password_hash || '')
    if (!ok) return res.status(401).json({ message: 'Invalid email or password.' })

    return res.status(200).json({
      message: 'Credentials verified.',
      user: {
        id: rider.id,
        email: rider.email,
        full_name: rider.full_name,
        phone: rider.phone,
      },
    })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- POST /api/delivery/send-otp ----------
// Generates a 6-digit OTP, hashes + stores it with an expiry, emails it.
exports.sendOtp = async (req, res) => {
  try {
    const { user_id } = req.body
    if (!user_id) return res.status(400).json({ message: 'user_id is required.' })

    const { data: rider, error: fetchErr } = await supabase
      .from('delivery_riders')
      .select('id, email, full_name, is_active')
      .eq('id', user_id)
      .maybeSingle()

    if (fetchErr || !rider) return res.status(404).json({ message: 'Rider not found.' })
    if (!rider.is_active) return res.status(403).json({ message: 'Your account is deactivated. Contact admin.' })

    const otp = generateOtp()
    const otp_hash = await bcrypt.hash(otp, 10)
    const otp_expires_at = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

    const { error: updateErr } = await supabase
      .from('delivery_riders')
      .update({ otp_hash, otp_expires_at })
      .eq('id', user_id)
    if (updateErr) throw updateErr

    if (rider.email) {
      try {
        await sendNotificationEmail({
          to: rider.email,
          title: 'Your Delivery Portal Login Code',
          message: `Hi ${rider.full_name || ''}, your verification code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, contact your supervisor.`,
        })
      } catch (mailErr) {
        console.error('[delivery/send-otp] email failed:', mailErr.message)
        return res.status(500).json({ message: 'Could not send verification email. Please try again.' })
      }
    } else {
      return res.status(400).json({ message: 'No email on file for this rider account.' })
    }

    return res.status(200).json({ message: 'Verification code sent.' })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- POST /api/delivery/verify-otp ----------
// Verifies the OTP, clears it, issues the JWT + rider payload.
exports.verifyOtp = async (req, res) => {
  try {
    const { user_id, otp } = req.body
    if (!user_id || !otp) return res.status(400).json({ message: 'user_id and otp are required.' })

    const { data: rider, error } = await supabase
      .from('delivery_riders')
      .select('*')
      .eq('id', user_id)
      .maybeSingle()

    if (error || !rider) return res.status(404).json({ message: 'Rider not found.' })
    if (!rider.is_active) return res.status(403).json({ message: 'Your account is deactivated. Contact admin.' })

    if (!rider.otp_hash || !rider.otp_expires_at) {
      return res.status(400).json({ message: 'No verification code requested. Please request a new one.' })
    }
    if (new Date(rider.otp_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ message: 'Code expired. Please request a new one.' })
    }

    const ok = await bcrypt.compare(otp, rider.otp_hash)
    if (!ok) return res.status(401).json({ message: 'Incorrect code. Please try again.' })

    // Clear the OTP so it can't be reused
    await supabase
      .from('delivery_riders')
      .update({ otp_hash: null, otp_expires_at: null })
      .eq('id', rider.id)

    const token = jwt.sign({ id: rider.id, type: 'rider' }, process.env.JWT_SECRET, { expiresIn: '30d' })
    const { password_hash, otp_hash, otp_expires_at, ...safeRider } = rider

    return res.status(200).json({ token, rider: safeRider })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- POST /api/delivery/login (legacy single-step — kept for compatibility) ----------
exports.login = async (req, res) => {
  try {
    const { phone, email, password } = req.body
    if (!password || (!phone && !email)) {
      return res.status(400).json({ message: 'Phone/email and password are required' })
    }

    let q = supabase.from('delivery_riders').select('*')
    q = phone ? q.eq('phone', phone) : q.eq('email', email)
    const { data: rider, error } = await q.single()
    if (error || !rider) return res.status(401).json({ message: 'Invalid credentials' })
    if (!rider.is_active) return res.status(403).json({ message: 'Your account is deactivated. Contact admin.' })

    const ok = await bcrypt.compare(password, rider.password_hash || '')
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

    const token = jwt.sign({ id: rider.id, type: 'rider' }, process.env.JWT_SECRET, { expiresIn: '30d' })
    const { password_hash, ...safeRider } = rider
    res.json({ token, rider: safeRider })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- GET /api/delivery/my-orders ----------
exports.myOrders = async (req, res) => {
  try {
    const riderId = req.rider.id
    const page  = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Number(req.query.limit) || 15)
    const from  = (page - 1) * limit
    const to    = from + limit - 1

    let query = supabase
      .from('orders')
      .select('*, profiles:client_id(full_name)', { count: 'exact' })
      .eq('delivery_rider_id', riderId)

    if (req.query.delivery_status) query = query.eq('delivery_status', req.query.delivery_status)
    query = query.order('created_at', { ascending: false }).range(from, to)

    const { data, error, count } = await query
    if (error) throw error

    const items = (data || []).map(o => ({ ...o, client_name: o.profiles?.full_name || o.client_name || null }))

    const { data: all } = await supabase
      .from('orders').select('delivery_status').eq('delivery_rider_id', riderId)
    const summary = { total: (all || []).length }
    ;(all || []).forEach(o => { summary[o.delivery_status] = (summary[o.delivery_status] || 0) + 1 })

    res.json({ items, pagination: { total: count || 0, page, limit }, summary })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

// ---------- PUT /api/delivery/my-orders/:id ----------
exports.updateMyOrder = async (req, res) => {
  try {
    const { id } = req.params
    const { delivery_status, delivery_note, note } = req.body

    if (!RIDER_ALLOWED_STATUSES.includes(delivery_status)) {
      return res.status(400).json({ message: 'Invalid status for rider update' })
    }

    const { data: existing, error: findErr } = await supabase
      .from('orders').select('id, delivery_rider_id').eq('id', id).single()
    if (findErr || !existing) return res.status(404).json({ message: 'Order not found' })
    if (existing.delivery_rider_id !== req.rider.id) return res.status(403).json({ message: 'This order is not assigned to you' })

    const body = { delivery_status, delivery_note: delivery_note || note || null }
    if (delivery_status === 'picked_up') body.picked_up_at = new Date().toISOString()
    if (delivery_status === 'delivered') body.delivered_at = new Date().toISOString()

    const { data, error } = await supabase.from('orders').update(body).eq('id', id).select().single()
    if (error) throw error
    res.json({ order: data })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}