// src/routes/enrollmentsRoute.js
// Register in index.mjs:
//   const enrollmentsRoute = require('./routes/enrollmentsRoute')
//   app.use('/api/enrollments', enrollmentsRoute)

const express    = require('express')
const router     = express.Router()
const supabase   = require('../db/supabase')
const { authenticate } = require('../middleware/auth')

// ── helpers ───────────────────────────────────────────────────────────────────
function userId(req) { return req.user?.sub || req.user?.id }

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/enrollments
// Enroll the authenticated user in a course.
// Body: { course_id, is_free?, payment_id? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res, next) => {
  try {
    const uid = userId(req)
    const { course_id, is_free, payment_id } = req.body

    if (!course_id) {
      return res.status(400).json({ success: false, message: 'course_id is required.' })
    }

    // Verify course exists and is published
    const { data: course, error: ce } = await supabase
      .from('courses')
      .select('id, is_free, price, is_published')
      .eq('id', course_id)
      .single()

    if (ce || !course) {
      return res.status(404).json({ success: false, message: 'Course not found.' })
    }
    if (!course.is_published) {
      return res.status(400).json({ success: false, message: 'Course is not available.' })
    }

    const courseFree = course.is_free || !course.price || Number(course.price) === 0
    const status     = (is_free || courseFree) ? 'free' : 'pending'

    // Upsert — safe to call multiple times
    const { data, error } = await supabase
      .from('enrollments')
      .upsert(
        {
          user_id:      uid,
          course_id,
          status,
          payment_id:   payment_id || null,
          enrolled_at:  new Date().toISOString(),
          confirmed_at: status === 'free' ? new Date().toISOString() : null,
        },
        { onConflict: 'user_id,course_id', ignoreDuplicates: false }
      )
      .select()
      .single()

    if (error) throw error

    return res.status(201).json({ success: true, enrollment: data })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/enrollments/me
// List all enrollments for the authenticated user (with course data).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const uid = userId(req)

    const { data, error } = await supabase
      .from('enrollments')
      .select(`
        id, course_id, status, payment_id, enrolled_at, confirmed_at,
        courses (
          id, title, slug, emoji, level, price, price_label, is_free,
          lessons_count, duration_hours, tags, color, cover_image_url,
          thumbnail_url, is_published
        )
      `)
      .eq('user_id', uid)
      .neq('status', 'cancelled')
      .order('enrolled_at', { ascending: false })

    if (error) throw error

    return res.json({ success: true, enrollments: data || [] })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/enrollments/:courseId
// Unenroll the authenticated user from a course (soft cancel).
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:courseId', authenticate, async (req, res, next) => {
  try {
    const uid = userId(req)
    const { courseId } = req.params

    const { error } = await supabase
      .from('enrollments')
      .update({ status: 'cancelled' })
      .eq('user_id', uid)
      .eq('course_id', courseId)

    if (error) throw error

    return res.json({ success: true, message: 'Unenrolled successfully.' })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/enrollments/verify-pin
// Verify the global course access PIN.
// Body: { pin }
// Returns: { success: true } or 401
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify-pin', authenticate, async (req, res, next) => {
  try {
    const { pin } = req.body
    if (!pin) {
      return res.status(400).json({ success: false, message: 'PIN is required.' })
    }

    // Fetch the PIN from site_settings
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'course_pin')
      .single()

    if (error || !data) {
      return res.status(500).json({ success: false, message: 'PIN not configured. Contact admin.' })
    }

    // value is stored as JSON string e.g. '"1234"' — parse it
    let storedPin
    try { storedPin = JSON.parse(data.value) } catch { storedPin = data.value }

    if (String(pin).trim() !== String(storedPin).trim()) {
      return res.status(401).json({ success: false, message: 'Incorrect PIN. Please try again.' })
    }

    return res.json({ success: true, message: 'PIN verified.' })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/enrollments/:id/confirm   (admin only — called after payment approved)
// Confirms a pending enrollment. Also called by payment webhook / admin action.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/confirm', authenticate, async (req, res, next) => {
  try {
    // Only admin/staff can confirm
    const role = req.user?.role
    if (!['admin', 'staff'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Not authorised.' })
    }

    const { data, error } = await supabase
      .from('enrollments')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    return res.json({ success: true, enrollment: data })
  } catch (err) { next(err) }
})

const requireAdmin = (req, res, next) => {
  if (!['admin', 'staff'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Not authorised.' })
  }
  next()
}
 
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/enrollments/admin/list
// Query: course_id, status, search, page, limit
// Returns all enrollments with joined profile + course + payment data.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/list', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1)
    const limit  = Math.min(100, parseInt(req.query.limit) || 20)
    const offset = (page - 1) * limit

    const courseId = req.query.course_id || null
    const status   = req.query.status    || null
    const search   = (req.query.search   || '').toLowerCase().trim()

    // ── count ─────────────────────────────────────────────────────────────
    let cq = supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
    if (courseId) cq = cq.eq('course_id', courseId)
    if (status)   cq = cq.eq('status', status)
    const { count } = await cq

    // ── enrollments (no joins — fetch related tables separately) ──────────
    let q = supabase
      .from('enrollments')
      .select('id, user_id, course_id, status, payment_id, enrolled_at, confirmed_at, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (courseId) q = q.eq('course_id', courseId)
    if (status)   q = q.eq('status', status)

    const { data: rows, error: enrollErr } = await q
    if (enrollErr) throw enrollErr

    if (!rows || rows.length === 0) {
      return res.json({ success: true, items: [], pagination: { page, limit, total: count || 0 } })
    }

    // ── fetch profiles ─────────────────────────────────────────────────────
    const userIds    = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
    const courseIds  = [...new Set(rows.map(r => r.course_id).filter(Boolean))]
    const paymentIds = [...new Set(rows.map(r => r.payment_id).filter(Boolean))]

    const [profilesRes, coursesRes, paymentsRes] = await Promise.all([
      userIds.length
        ? supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', userIds)
        : { data: [] },
      courseIds.length
        ? supabase.from('courses').select('id, title, emoji, level, price, is_free, seats').in('id', courseIds)
        : { data: [] },
      paymentIds.length
        ? supabase.from('payments').select('id, amount, method, status, transaction_id').in('id', paymentIds)
        : { data: [] },
    ])

    // ── build lookup maps ──────────────────────────────────────────────────
    const profileMap = Object.fromEntries((profilesRes.data || []).map(p => [p.id, p]))
    const courseMap  = Object.fromEntries((coursesRes.data  || []).map(c => [c.id, c]))
    const paymentMap = Object.fromEntries((paymentsRes.data || []).map(p => [p.id, p]))

    // ── apply search filter ────────────────────────────────────────────────
    let filtered = rows
    if (search) {
      filtered = rows.filter(r => {
        const prof = profileMap[r.user_id]
        return (
          (prof?.full_name || '').toLowerCase().includes(search) ||
          (prof?.email     || '').toLowerCase().includes(search)
        )
      })
    }

    // ── shape response ─────────────────────────────────────────────────────
    const items = filtered.map(e => {
      const prof = profileMap[e.user_id]  || {}
      const crs  = courseMap[e.course_id] || {}
      const pay  = paymentMap[e.payment_id] || {}

      return {
        id:             e.id,
        user_id:        e.user_id,
        payment_id:     e.payment_id     || null,
        user_name:      prof.full_name   || '—',
        user_email:     prof.email       || '',
        avatar_url:     prof.avatar_url  || null,
        course_id:      e.course_id,
        course_title:   crs.title        || '—',
        course_emoji:   crs.emoji        || '📚',
        course_level:   crs.level        || null,
        course_seats:   crs.seats        || null,
        payment_status: e.status,
        is_free:        crs.is_free || Number(pay.amount || 0) === 0,
        amount:         pay.amount       || 0,
        method:         pay.method       || null,
        transaction_id: pay.transaction_id || null,
        enrolled_at:    e.enrolled_at,
        confirmed_at:   e.confirmed_at,
        created_at:     e.created_at,
      }
    })

    return res.json({
      success: true,
      items,
      pagination: { page, limit, total: count || 0 },
    })
  } catch (err) { next(err) }
})
 
// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/enrollments/admin/:id
// Confirm or update an enrollment status.
// Body: { status }   e.g. { status: 'confirmed' }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status, payment_status, confirmed_at } = req.body
    const incoming = status || payment_status
 
    const STATUS_MAP = { paid: 'confirmed', confirmed: 'confirmed', free: 'free', pending: 'pending', cancelled: 'cancelled' }
    const resolvedStatus = STATUS_MAP[incoming] || incoming
 
    const updates = {
      status:       resolvedStatus,
      updated_at:   new Date().toISOString(),
    }
    if (['confirmed', 'free'].includes(resolvedStatus)) {
      updates.confirmed_at = confirmed_at || new Date().toISOString()
    }
 
    const { data, error } = await supabase
      .from('enrollments')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
 
    if (error) throw error
    return res.json({ success: true, enrollment: data })
  } catch (err) { next(err) }
})
 
// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/enrollments/admin/:id
// Hard-delete an enrollment (revoke). Also best-effort cancels linked payment.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // fetch first so we know the linked payment_id
    const { data: enr } = await supabase
      .from('enrollments')
      .select('id, payment_id')
      .eq('id', req.params.id)
      .single()
 
    if (!enr) return res.status(404).json({ success: false, message: 'Enrollment not found.' })
 
    const { error } = await supabase.from('enrollments').delete().eq('id', req.params.id)
    if (error) throw error
 
    // best-effort: mark linked payment as failed
    if (enr.payment_id) {
      supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('id', enr.payment_id)
        .then(() => {})
        .catch(e => console.warn('payment cancel:', e.message))
    }
 
    return res.json({ success: true, message: 'Enrollment revoked.' })
  } catch (err) { next(err) }
})
 
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/enrollments/admin/course-pin   — read current PIN
// PUT /api/enrollments/admin/course-pin   — update PIN
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/course-pin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'course_pin').single()
    const pin = data ? JSON.parse(data.value) : null
    return res.json({ success: true, pin })
  } catch (err) { next(err) }
})
 
router.put('/admin/course-pin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { pin } = req.body
    if (!pin || String(pin).trim().length < 3) {
      return res.status(400).json({ success: false, message: 'PIN must be at least 3 characters.' })
    }
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key: 'course_pin', value: JSON.stringify(String(pin).trim()), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    return res.json({ success: true, message: 'Course PIN updated.' })
  } catch (err) { next(err) }
})

module.exports = router