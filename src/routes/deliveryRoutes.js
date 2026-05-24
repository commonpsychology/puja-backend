// routes/delivery.js  →  app.use('/api/delivery', require('./routes/delivery'))
// Endpoints:
//   POST /check-credentials   step 1 of login — validates email+password
//   POST /send-otp            sends 6-digit code to rider's email
//   POST /verify-otp          validates code → returns { token, rider }
//   GET  /my-orders           rider's assigned orders (paginated + summary)
//   PUT  /my-orders/:id       rider updates delivery_status only
//   GET  /me                  rider profile for dashboard Profile tab

const express  = require('express')
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const crypto   = require('crypto')
const nodemailer = require('nodemailer')          // npm i nodemailer
const { createClient } = require('@supabase/supabase-js')

const router  = express.Router()
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ── Email transport (same env vars your staff OTP uses) ───────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
})

// ── Helpers ───────────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '12h' })
}

// Verify delivery JWT and return the rider row (joined with profiles).
// Called by every authenticated route below.
async function getRider(req) {
  const header = req.headers['authorization'] || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw { status: 401, message: 'Not authenticated.' }
  let decoded
  try { decoded = jwt.verify(token, process.env.JWT_SECRET) }
  catch { throw { status: 401, message: 'Invalid or expired session.' } }

  const { data: rider, error } = await supabase
    .from('delivery_riders')
    .select(`id, user_id, area, vehicle_type, vehicle_number,
             is_active, is_available, total_delivered, total_failed,
             profiles!inner ( id, full_name, email, phone, is_active )`)
    .eq('user_id', decoded.userId || decoded.id || decoded.sub)
    .single()

  if (error || !rider)            throw { status: 403, message: 'Rider not found.' }
  if (!rider.is_active)           throw { status: 403, message: 'Account is inactive.' }
  if (!rider.profiles.is_active)  throw { status: 403, message: 'Account is inactive.' }
  return rider
}

// ─────────────────────────────────────────────────────────────
// POST /api/delivery/check-credentials
// Validates email + password. Returns user info for the OTP modal.
// Does NOT issue a token — that happens after verify-otp.
// routes/delivery.js — replace ONLY the check-credentials handler

router.post('/check-credentials', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' })

    // ── Step 1: verify credentials via Supabase Auth ──────────
    // (replaces the old bcrypt.compare against profiles.password_hash
    //  which is always null when the user was created via admin.createUser)
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email:    email.trim().toLowerCase(),
        password,
      })

    if (authError || !authData?.user)
      return res.status(401).json({ message: 'Invalid email or password.' })

    const userId = authData.user.id

    // ── Step 2: check profiles row (role + is_active) ─────────
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, is_active')
      .eq('id', userId)
      .single()

    if (profileError || !profile)
      return res.status(401).json({ message: 'Profile not found.' })
    if (!profile.is_active)
      return res.status(403).json({ message: 'Account is inactive. Contact admin.' })
    if (profile.role !== 'rider')
      return res.status(403).json({ message: 'This portal is for delivery riders only.' })

    // ── Step 3: check delivery_riders row ─────────────────────
    const { data: riderRow, error: rErr } = await supabase
      .from('delivery_riders')
      .select('id, is_active, area, vehicle_type, vehicle_number')
      .eq('user_id', userId)          // ← matches your FK column name
      .single()

    if (rErr || !riderRow)
      return res.status(403).json({ message: 'Rider profile not set up. Contact admin.' })
    if (!riderRow.is_active)
      return res.status(403).json({ message: 'Account is inactive. Contact admin.' })

    // ── Step 4: return user info for OTP modal ────────────────
    return res.status(200).json({
      user: {
        id:        profile.id,
        full_name: profile.full_name,
        email:     profile.email,
        phone:     profile.phone,
        rider_id:  riderRow.id,
        area:      riderRow.area,
      },
    })
  } catch (err) {
    console.error('[delivery/check-credentials]', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /api/delivery/send-otp
// Body: { user_id }
// Generates a 6-digit code, stores it in otp_codes (or delivery_otps),
// emails it to the rider. Called by DeliveryOTPModal on mount + resend.
// Mirrors your staff OTP send endpoint exactly.
// ─────────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { user_id } = req.body
    if (!user_id) return res.status(400).json({ message: 'user_id is required.' })

    // Confirm the user is a rider
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('id', user_id)
      .single()

    if (error || !profile)   return res.status(404).json({ message: 'User not found.' })
    if (!profile.is_active)  return res.status(403).json({ message: 'Account is inactive.' })
    if (profile.role !== 'rider')
      return res.status(403).json({ message: 'Not a rider account.' })

    // Generate code + expiry (10 min)
    const code    = String(Math.floor(100000 + Math.random() * 900000))
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // Store in otp_codes table (adjust table name to match your staff OTP table)
    // Schema assumed: { id, user_id, code, expires_at, used, created_at }
    await supabase.from('otp_codes').delete().eq('user_id', user_id)  // clear old codes
    const { error: insertErr } = await supabase.from('otp_codes').insert({
      user_id,
      code,
      expires_at: expires,
      used: false,
    })
    if (insertErr) {
      console.error('[delivery/send-otp] insert error:', insertErr)
      return res.status(500).json({ message: 'Failed to generate OTP.' })
    }

    // Send email — same template style as your staff OTP
    await mailer.sendMail({
      from:    `"Common Psychology" <${process.env.SMTP_USER}>`,
      to:      profile.email,
      subject: 'Your Delivery Portal Login Code',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
          <h2 style="color:#007BA8;margin-bottom:.5rem">🚴 Delivery Portal Login</h2>
          <p>Hi <strong>${profile.full_name}</strong>,</p>
          <p>Your one-time login code is:</p>
          <div style="font-size:2.5rem;font-weight:800;letter-spacing:.25em;color:#1a3a4a;
                      background:#E0F7FF;border-radius:12px;padding:1rem 1.5rem;
                      text-align:center;margin:1.25rem 0">${code}</div>
          <p style="color:#7a9aaa;font-size:.85rem">
            This code expires in <strong>10 minutes</strong>.<br>
            If you didn't try to log in, contact your supervisor immediately.
          </p>
        </div>`,
    })

    return res.status(200).json({ message: `Code sent to ${profile.email}` })
  } catch (err) {
    console.error('[delivery/send-otp]', err)
    return res.status(500).json({ message: 'Failed to send OTP. Try again.' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /api/delivery/verify-otp
// Body: { user_id, otp }
// Validates the code → returns { token, rider } on success.
// DeliveryOTPModal calls onSuccess(token, rider) which DeliveryLoginPage
// stores as deliveryToken + deliveryRider in localStorage.
// ─────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { user_id, otp } = req.body
    if (!user_id || !otp) return res.status(400).json({ message: 'user_id and otp are required.' })

    // Fetch the stored code
    const { data: record, error } = await supabase
      .from('otp_codes')
      .select('id, code, expires_at, used')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !record)        return res.status(400).json({ message: 'No code found. Request a new one.' })
    if (record.used)             return res.status(400).json({ message: 'Code already used. Request a new one.' })
    if (new Date(record.expires_at) < new Date())
      return res.status(400).json({ message: 'Code expired. Request a new one.' })
    if (record.code !== String(otp).trim())
      return res.status(400).json({ message: 'Incorrect code. Please try again.' })

    // Mark used
    await supabase.from('otp_codes').update({ used: true }).eq('id', record.id)

    // Fetch rider + profile for the response (shape expected by DeliveryLoginPage)
    const { data: rider, error: rErr } = await supabase
      .from('delivery_riders')
      .select(`id, area, vehicle_type, vehicle_number, is_available,
               total_delivered, total_failed,
               profiles!inner ( id, full_name, email, phone )`)
      .eq('user_id', user_id)
      .single()

    if (rErr || !rider) return res.status(500).json({ message: 'Rider profile not found.' })

    const token = signToken(user_id)

    // rider object shape → stored as deliveryRider in localStorage by DeliveryLoginPage
    // DeliveryDashboardPage reads: rider.name, rider.email, rider.phone, rider.area
    return res.status(200).json({
      token,
      rider: {
        id:              rider.id,
        name:            rider.profiles.full_name,
        email:           rider.profiles.email,
        phone:           rider.profiles.phone,
        area:            rider.area,
        vehicle_type:    rider.vehicle_type,
        vehicle_number:  rider.vehicle_number,
        is_available:    rider.is_available,
        total_delivered: rider.total_delivered,
        total_failed:    rider.total_failed,
      },
    })
  } catch (err) {
    console.error('[delivery/verify-otp]', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /api/delivery/my-orders
// Returns only THIS rider's orders. Feeds stat cards + table.
// Query: ?delivery_status=in_transit  &page=1  &limit=15
// ─────────────────────────────────────────────────────────────
router.get('/my-orders', async (req, res) => {
  try {
    const rider  = await getRider(req)
    const page   = Math.max(1, parseInt(req.query.page)  || 1)
    const limit  = Math.min(50, parseInt(req.query.limit) || 15)
    const offset = (page - 1) * limit
    const dsFilter = req.query.delivery_status || null
    const VALID_DS = ['unassigned','assigned','picked_up','in_transit','delivered','failed','returned']
    if (dsFilter && !VALID_DS.includes(dsFilter))
      return res.status(400).json({ message: 'Invalid delivery_status filter.' })

    let q = supabase
      .from('orders')
      .select(`id, order_number, status, total_amount, payment_status,
               delivery_status, delivery_address, delivery_note,
               picked_up_at, delivered_at, failed_at, created_at, updated_at,
               profiles!client_id ( full_name )`, { count: 'exact' })
      .eq('delivery_rider_id', rider.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (dsFilter) q = q.eq('delivery_status', dsFilter)

    const { data: rows, error: qErr, count } = await q
    if (qErr) { console.error('[delivery/my-orders]', qErr); return res.status(500).json({ message: 'Failed to fetch orders.' }) }

    const items = (rows || []).map(o => ({ ...o, client_name: o.profiles?.full_name || null, profiles: undefined }))

    // Summary counts for all statuses (no pagination — fast separate query)
    const { data: all } = await supabase.from('orders').select('delivery_status').eq('delivery_rider_id', rider.id)
    const summary = { total: 0, assigned: 0, picked_up: 0, in_transit: 0, delivered: 0, failed: 0, returned: 0 }
    ;(all || []).forEach(r => { summary.total++; if (summary[r.delivery_status] !== undefined) summary[r.delivery_status]++ })

    return res.status(200).json({ items, pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) }, summary })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error('[delivery/my-orders GET]', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// PUT /api/delivery/my-orders/:id
// Rider updates delivery_status + optional note.
// Allowed statuses: picked_up, in_transit, delivered, failed, returned
// ─────────────────────────────────────────────────────────────
router.put('/my-orders/:id', async (req, res) => {
  try {
    const rider  = await getRider(req)
    const { delivery_status, delivery_note, note } = req.body
    const resolvedNote = delivery_note || note || null
    const RIDER_STATUSES = ['picked_up','in_transit','delivered','failed','returned']

    if (!delivery_status || !RIDER_STATUSES.includes(delivery_status))
      return res.status(400).json({ message: `delivery_status must be one of: ${RIDER_STATUSES.join(', ')}` })

    const { data: order, error: fetchErr } = await supabase
      .from('orders').select('id, delivery_status, delivery_rider_id, order_number').eq('id', req.params.id).single()
    if (fetchErr || !order)              return res.status(404).json({ message: 'Order not found.' })
    if (order.delivery_rider_id !== rider.id) return res.status(403).json({ message: 'This order is not assigned to you.' })
    if (['delivered','returned'].includes(order.delivery_status))
      return res.status(409).json({ message: `Order is already ${order.delivery_status}.` })

    const now = new Date().toISOString()
    const patch = { delivery_status, delivery_note: resolvedNote, updated_at: now }
    if (delivery_status === 'picked_up' && !order.picked_up_at) patch.picked_up_at = now
    if (delivery_status === 'delivered') patch.delivered_at = now
    if (delivery_status === 'failed')    patch.failed_at    = now

    const { data: updated, error: upErr } = await supabase
      .from('orders').update(patch).eq('id', req.params.id)
      .select('id, order_number, delivery_status, delivery_note, delivered_at, updated_at').single()
    if (upErr) { console.error('[delivery/my-orders PUT]', upErr); return res.status(500).json({ message: 'Failed to update order.' }) }

    // Audit trail (non-blocking)
    supabase.from('delivery_status_history').insert({
      order_id: req.params.id, rider_id: rider.id,
      old_status: order.delivery_status, new_status: delivery_status,
      note: resolvedNote, changed_by: rider.user_id,
    }).then(({ error }) => { if (error) console.warn('[delivery] history log failed:', error.message) })

    // Bump counters (non-blocking)
    if (delivery_status === 'delivered')
      supabase.from('delivery_riders').update({ total_delivered: rider.total_delivered + 1 }).eq('id', rider.id).then(() => {})
    if (delivery_status === 'failed')
      supabase.from('delivery_riders').update({ total_failed: rider.total_failed + 1 }).eq('id', rider.id).then(() => {})

    return res.status(200).json({ message: `Delivery status updated to ${delivery_status}.`, order: updated })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error('[delivery/my-orders PUT]', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /api/delivery/me  →  Profile tab in DeliveryDashboardPage
// ─────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const rider = await getRider(req)
    return res.status(200).json({
      id: rider.id, name: rider.profiles.full_name, email: rider.profiles.email,
      phone: rider.profiles.phone, area: rider.area, vehicle_type: rider.vehicle_type,
      vehicle_number: rider.vehicle_number, is_available: rider.is_available,
      total_delivered: rider.total_delivered, total_failed: rider.total_failed,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

module.exports = router