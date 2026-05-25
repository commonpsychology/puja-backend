// routes/delivery.js — COMPLETE FIXED FILE
// ─────────────────────────────────────────────────────────────
// Fix: check-credentials now uses ANON KEY client for signInWithPassword
// Everything else unchanged from your working document 12.
// ─────────────────────────────────────────────────────────────

const express    = require('express')
const jwt        = require('jsonwebtoken')
const nodemailer = require('nodemailer')
const { createClient } = require('@supabase/supabase-js')

const router = express.Router()

// ── TWO Supabase clients — this is the entire fix ─────────────
// SERVICE ROLE → all DB queries (bypasses RLS, never for auth sign-in)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
// ANON KEY → auth.signInWithPassword only (this is what was missing)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// ── Email transport ───────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
})

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '12h' })
}

// ── Auth guard for protected routes ──────────────────────────
async function getRider(req) {
  const header = req.headers['authorization'] || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw { status: 401, message: 'Not authenticated.' }
  let decoded
  try { decoded = jwt.verify(token, process.env.JWT_SECRET) }
  catch { throw { status: 401, message: 'Invalid or expired session.' } }

  const { data: rider, error } = await supabase
    .from('delivery_riders')
    .select(`
      id, user_id, area, vehicle_type, vehicle_number,
      is_active, is_available, total_delivered, total_failed,
      profiles!inner ( id, full_name, email, phone, is_active )
    `)
    .eq('user_id', decoded.userId || decoded.id || decoded.sub)
    .single()

  if (error || !rider)           throw { status: 403, message: 'Rider not found.' }
  if (!rider.is_active)          throw { status: 403, message: 'Account is inactive.' }
  if (!rider.profiles.is_active) throw { status: 403, message: 'Account is inactive.' }
  return rider
}

// ─────────────────────────────────────────────────────────────
// POST /api/delivery/check-credentials
// ─────────────────────────────────────────────────────────────
router.post('/check-credentials', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' })

    const normalizedEmail = email.trim().toLowerCase()

    // ── Step 1: verify password via Supabase Auth ─────────────
    // MUST use supabaseAnon (anon key), NOT supabase (service role).
    // service role cannot call signInWithPassword — it has no concept
    // of sessions. This was the root cause of "Profile not found".
    const { data: authData, error: authError } =
      await supabaseAnon.auth.signInWithPassword({
        email:    normalizedEmail,
        password,
      })

    if (authError || !authData?.user) {
      console.error('[delivery/check-credentials] Supabase Auth error:', authError?.message)
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const userId = authData.user.id

    // Sign out the Supabase session immediately — we only needed
    // credential verification. Our actual auth uses a custom JWT.
    await supabaseAnon.auth.signOut().catch(() => {})

    // ── Step 2: fetch profiles row ────────────────────────────
    // Use service role client — guaranteed to work regardless of RLS.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, is_active')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('[delivery/check-credentials] profile not found for userId:', userId, profileError?.message)
      return res.status(404).json({ message: 'Profile not found. Contact admin.' })
    }

    if (!profile.is_active)
      return res.status(403).json({ message: 'Account is inactive. Contact admin.' })

    if (profile.role !== 'rider')
      return res.status(403).json({ message: 'This portal is for delivery riders only.' })

    // ── Step 3: fetch delivery_riders row ─────────────────────
    const { data: riderRow, error: riderError } = await supabase
      .from('delivery_riders')
      .select('id, is_active, is_available, area, vehicle_type, vehicle_number')
      .eq('user_id', userId)
      .single()

    if (riderError || !riderRow) {
      console.error('[delivery/check-credentials] delivery_riders row not found:', riderError?.message)
      return res.status(403).json({ message: 'Rider profile not set up. Contact admin.' })
    }

    if (!riderRow.is_active)
      return res.status(403).json({ message: 'Rider account is inactive. Contact admin.' })

    // ── Step 4: return info for OTP modal ─────────────────────
    return res.status(200).json({
      user: {
        id:           profile.id,    // ← passed as user_id to send-otp and verify-otp
        full_name:    profile.full_name,
        email:        profile.email,
        phone:        profile.phone,
        rider_id:     riderRow.id,
        area:         riderRow.area,
        vehicle_type: riderRow.vehicle_type,
      },
    })

  } catch (err) {
    console.error('[delivery/check-credentials] unexpected error:', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /api/delivery/send-otp
// ─────────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { user_id } = req.body
    if (!user_id) return res.status(400).json({ message: 'user_id is required.' })

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('id', user_id)
      .single()

    if (error || !profile)  return res.status(404).json({ message: 'User not found.' })
    if (!profile.is_active) return res.status(403).json({ message: 'Account is inactive.' })
    if (profile.role !== 'rider')
      return res.status(403).json({ message: 'Not a rider account.' })

    const code    = String(Math.floor(100000 + Math.random() * 900000))
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    await supabase.from('otp_codes').delete().eq('user_id', user_id)
    const { error: insertErr } = await supabase.from('otp_codes').insert({
      user_id,
      code,
      expires_at: expires,
      used:       false,
    })

    if (insertErr) {
      console.error('[delivery/send-otp] insert error:', insertErr)
      return res.status(500).json({ message: 'Failed to generate OTP.' })
    }

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
            Expires in <strong>10 minutes</strong>.<br>
            If you didn't request this, contact your supervisor.
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
// ─────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { user_id, otp } = req.body
    if (!user_id || !otp)
      return res.status(400).json({ message: 'user_id and otp are required.' })

    const { data: record, error } = await supabase
      .from('otp_codes')
      .select('id, code, expires_at, used')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !record)
      return res.status(400).json({ message: 'No code found. Request a new one.' })
    if (record.used)
      return res.status(400).json({ message: 'Code already used. Request a new one.' })
    if (new Date(record.expires_at) < new Date())
      return res.status(400).json({ message: 'Code expired. Request a new one.' })
    if (record.code !== String(otp).trim())
      return res.status(400).json({ message: 'Incorrect code. Please try again.' })

    await supabase.from('otp_codes').update({ used: true }).eq('id', record.id)

    const { data: rider, error: rErr } = await supabase
      .from('delivery_riders')
      .select(`
        id, area, vehicle_type, vehicle_number, is_available,
        total_delivered, total_failed,
        profiles!inner ( id, full_name, email, phone )
      `)
      .eq('user_id', user_id)
      .single()

    if (rErr || !rider)
      return res.status(500).json({ message: 'Rider profile not found.' })

    return res.status(200).json({
      token: signToken(user_id),
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
      .select(`
        id, order_number, status, total_amount, payment_status,
        delivery_status, delivery_address, delivery_note,
        picked_up_at, delivered_at, failed_at, created_at, updated_at,
        profiles!client_id ( full_name )
      `, { count: 'exact' })
      .eq('delivery_rider_id', rider.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (dsFilter) q = q.eq('delivery_status', dsFilter)

    const { data: rows, error: qErr, count } = await q
    if (qErr) {
      console.error('[delivery/my-orders]', qErr)
      return res.status(500).json({ message: 'Failed to fetch orders.' })
    }

    const items = (rows || []).map(o => ({
      ...o,
      client_name: o.profiles?.full_name || null,
      profiles:    undefined,
    }))

    const { data: all } = await supabase
      .from('orders')
      .select('delivery_status')
      .eq('delivery_rider_id', rider.id)

    const summary = { total: 0, assigned: 0, picked_up: 0, in_transit: 0, delivered: 0, failed: 0, returned: 0 }
    ;(all || []).forEach(r => {
      summary.total++
      if (summary[r.delivery_status] !== undefined) summary[r.delivery_status]++
    })

    return res.status(200).json({
      items,
      pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) },
      summary,
    })

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error('[delivery/my-orders GET]', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// PUT /api/delivery/my-orders/:id
// ─────────────────────────────────────────────────────────────
router.put('/my-orders/:id', async (req, res) => {
  try {
    const rider          = await getRider(req)
    const { delivery_status, delivery_note, note } = req.body
    const resolvedNote   = delivery_note || note || null
    const RIDER_STATUSES = ['picked_up','in_transit','delivered','failed','returned']

    if (!delivery_status || !RIDER_STATUSES.includes(delivery_status))
      return res.status(400).json({ message: `delivery_status must be one of: ${RIDER_STATUSES.join(', ')}` })

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, delivery_status, delivery_rider_id, order_number')
      .eq('id', req.params.id)
      .single()

    if (fetchErr || !order)
      return res.status(404).json({ message: 'Order not found.' })
    if (order.delivery_rider_id !== rider.id)
      return res.status(403).json({ message: 'This order is not assigned to you.' })
    if (['delivered','returned'].includes(order.delivery_status))
      return res.status(409).json({ message: `Order is already ${order.delivery_status}.` })

    const now   = new Date().toISOString()
    const patch = { delivery_status, delivery_note: resolvedNote, updated_at: now }
    if (delivery_status === 'picked_up' && !order.picked_up_at) patch.picked_up_at = now
    if (delivery_status === 'delivered') patch.delivered_at = now
    if (delivery_status === 'failed')    patch.failed_at    = now

    const { data: updated, error: upErr } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', req.params.id)
      .select('id, order_number, delivery_status, delivery_note, delivered_at, updated_at')
      .single()

    if (upErr) {
      console.error('[delivery/my-orders PUT]', upErr)
      return res.status(500).json({ message: 'Failed to update order.' })
    }

    supabase.from('delivery_status_history').insert({
      order_id:   req.params.id,
      rider_id:   rider.id,
      old_status: order.delivery_status,
      new_status: delivery_status,
      note:       resolvedNote,
      changed_by: rider.user_id,
    }).then(({ error }) => {
      if (error) console.warn('[delivery] history log failed:', error.message)
    })

    if (delivery_status === 'delivered')
      supabase.from('delivery_riders')
        .update({ total_delivered: rider.total_delivered + 1 })
        .eq('id', rider.id).then(() => {})
    if (delivery_status === 'failed')
      supabase.from('delivery_riders')
        .update({ total_failed: rider.total_failed + 1 })
        .eq('id', rider.id).then(() => {})

    return res.status(200).json({
      message: `Delivery status updated to ${delivery_status}.`,
      order:   updated,
    })

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error('[delivery/my-orders PUT]', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /api/delivery/me
// ─────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const rider = await getRider(req)
    return res.status(200).json({
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
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    return res.status(500).json({ message: 'Internal server error.' })
  }
})

module.exports = router