// src/routes/workshopRoutes.js
const express  = require('express')
const router   = express.Router()
const supabase = require('../db/supabase')

// ── PUBLIC ROUTES ──────────────────────────────────────────────────────────

// GET /api/workshops
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workshops_with_counts')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ success: true, workshops: data || [] })
  } catch (err) {
    console.error('[GET /workshops]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch workshops' })
  }
})

// GET /api/workshops/my-registrations?email=you@email.com
// ⚠️ MUST be before /:id
router.get('/my-registrations', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email required' })
  }
  try {
    const { data, error } = await supabase
      .from('workshop_registrations')
      .select(`
        id,
        workshop_id,
        attendee_name,
        attendee_email,
        attendee_phone,
        notes,
        is_free,
        payment_status,
        payment_ref,
        status,
        created_at,
        workshops (
          id,
          emoji,
          title,
          facilitator,
          date,
          time,
          mode,
          seats,
          price,
          tags,
          color
        )
      `)
      .eq('attendee_email', email)
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json({ success: true, registrations: data || [] })
  } catch (err) {
    console.error('[GET /workshops/my-registrations]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch registrations' })
  }
})

// GET /api/workshops/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workshops_with_counts')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error || !data) return res.status(404).json({ success: false, error: 'Workshop not found' })
    res.json({ success: true, workshop: data })
  } catch (err) {
    console.error('[GET /workshops/:id]', err.message)
    res.status(500).json({ success: false, error: 'Failed to fetch workshop' })
  }
})

// POST /api/workshops/register
// FIX 2: Returns full registration object on 409 so frontend can resume payment
router.post('/register', async (req, res) => {
  const { workshop_id, attendee_name, attendee_email, attendee_phone, notes, payment_ref } = req.body
  if (!workshop_id || !attendee_name || !attendee_email || !attendee_phone) {
    return res.status(400).json({ success: false, error: 'Missing required fields' })
  }
  try {
    const { data: ws, error: wsErr } = await supabase
      .from('workshops_with_counts')
      .select('*')
      .eq('id', workshop_id)
      .single()
    if (wsErr || !ws) return res.status(404).json({ success: false, error: 'Workshop not found' })

    if (parseInt(ws.booked || 0) >= ws.seats) {
      return res.status(409).json({ success: false, error: 'Workshop is full' })
    }

    // FIX 2: Check for existing registration and return FULL object so
    // frontend ensureRegistration() can reuse the id for payment
    const { data: existing } = await supabase
      .from('workshop_registrations')
      .select('id, payment_status, status')
      .eq('workshop_id', workshop_id)
      .eq('attendee_email', attendee_email.trim().toLowerCase())
      .maybeSingle()

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Already registered with this email',
        registration: {
          id:             existing.id,
          payment_status: existing.payment_status,
          status:         existing.status,
        },
      })
    }

    const isFree = ws.price === 0
    const { data, error } = await supabase
      .from('workshop_registrations')
      .insert({
        workshop_id,
        attendee_name:  attendee_name.trim(),
        attendee_email: attendee_email.trim().toLowerCase(),
        attendee_phone: attendee_phone.trim(),
        notes:          notes || '',
        is_free:        isFree,
        payment_status: isFree ? 'free' : (payment_ref ? 'paid' : 'pending'),
        payment_ref:    payment_ref || null,
      })
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, registration: data })
  } catch (err) {
    console.error('[POST /workshops/register]', err.message)
    res.status(500).json({ success: false, error: 'Registration failed' })
  }
})

// PATCH /api/workshops/registration/:id/payment
// FIX 3: Was returning 500 because 'status' column may not exist — only update
// payment_status and payment_ref which are the actual columns
router.patch('/registration/:id/payment', async (req, res) => {
  const { payment_status, payment_ref } = req.body
  const { id } = req.params

  if (!payment_status) {
    return res.status(400).json({ success: false, error: 'payment_status is required' })
  }

  try {
    // First verify the registration exists
    const { data: existing, error: fetchErr } = await supabase
      .from('workshop_registrations')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Registration not found' })
    }

    const updates = { payment_status }
    if (payment_ref) updates.payment_ref = payment_ref

    // Also update status to confirmed when payment is marked paid
    if (payment_status === 'paid' || payment_status === 'confirmed') {
      updates.status = 'confirmed'
    }

    const { data, error } = await supabase
      .from('workshop_registrations')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, registration: data })
  } catch (err) {
    console.error('[PATCH /workshops/registration/:id/payment]', err.message)
    res.status(500).json({ success: false, error: err.message || 'Failed to update payment' })
  }
})

// ── ADMIN ROUTES ───────────────────────────────────────────────────────────

// GET /api/workshops/admin/all
router.get('/admin/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workshops_with_counts')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) throw error
    res.json({ success: true, workshops: data || [] })
  } catch (err) {
    console.error('[GET /workshops/admin/all]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/workshops/admin/registrations
router.get('/admin/registrations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workshop_registrations')
      .select('*, workshops(title, date, facilitator)')
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json({ success: true, registrations: data || [] })
  } catch (err) {
    console.error('[GET /workshops/admin/registrations]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/workshops/admin — create workshop
router.post('/admin', async (req, res) => {
  try {
    const allowed = [
      'title', 'facilitator', 'date', 'time', 'seats', 'price',
      'mode', 'tags', 'description', 'color', 'emoji', 'sort_order',
      'is_active', 'image_url',
    ]
    const payload = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    )
    if (payload.seats      !== undefined) payload.seats      = Math.max(1, parseInt(payload.seats, 10) || 1)
    if (payload.price      !== undefined) payload.price      = Math.max(0, parseInt(payload.price, 10) || 0)
    if (payload.sort_order !== undefined) payload.sort_order = parseInt(payload.sort_order, 10) || 0

    const { data, error } = await supabase
      .from('workshops')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, workshop: data })
  } catch (err) {
    console.error('[POST /workshops/admin]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── FIX 1: PATCH /api/workshops/admin/registrations/:id ───────────────────
// Frontend calls /admin/registrations/:id — backend only had /admin/reg/:id
// This is the CORRECT route the admin dashboard uses to confirm/cancel registrations
// Declared BEFORE /admin/:id so Express doesn't treat "registrations" as a workshop id
router.patch('/admin/registrations/:id', async (req, res) => {
  const { status, payment_status } = req.body
  const { id } = req.params

  const allowedStatuses = ['confirmed', 'cancelled', 'pending']
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
    })
  }

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('workshop_registrations')
      .select('*, workshops(title)')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: 'Registration not found' })
    }

    // Build the update object
    const regUpdate = {}
    if (status) regUpdate.status = status

    // Derive payment_status from status if not explicitly provided
    if (payment_status) {
      regUpdate.payment_status = payment_status
    } else if (status === 'cancelled') {
      regUpdate.payment_status = 'cancelled'
    } else if (status === 'confirmed' && existing.is_free) {
      regUpdate.payment_status = 'free'
    } else if (status === 'confirmed' && !existing.is_free) {
      regUpdate.payment_status = 'paid'
    }

    const { data: reg, error: updateErr } = await supabase
      .from('workshop_registrations')
      .update(regUpdate)
      .eq('id', id)
      .select('*, workshops(title)')
      .single()
    if (updateErr) throw updateErr

    // Send notification if user_id exists
    if (existing.user_id) {
      const workshopTitle = existing.workshops?.title || 'the workshop'
      const isConfirmed   = status === 'confirmed'
      await supabase.from('notifications').insert({
        user_id: existing.user_id,
        title:   isConfirmed ? 'Registration Confirmed 🎉' : 'Registration Cancelled',
        message: isConfirmed
          ? `Your spot in "${workshopTitle}" is confirmed! We look forward to seeing you.`
          : `Your registration for "${workshopTitle}" has been cancelled. Contact us if this was unexpected.`,
        type:    'system',
        is_read: false,
      }).catch(e => console.warn('[notifications insert]', e.message))
    }

    res.json({ success: true, registration: reg })
  } catch (err) {
    console.error('[PATCH /workshops/admin/registrations/:id]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// Keep the old /admin/reg/:id route as a redirect alias so nothing breaks
// if any other code still calls the old path
router.patch('/admin/reg/:id', async (req, res) => {
  // Forward to the new handler by mutating params and re-using same logic
  req.params.id = req.params.id
  const { status, payment_status } = req.body
  const { id } = req.params

  const allowedStatuses = ['confirmed', 'cancelled', 'pending']
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
    })
  }

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('workshop_registrations')
      .select('*, workshops(title)')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: 'Registration not found' })
    }

    const regUpdate = {}
    if (status) regUpdate.status = status
    if (payment_status) {
      regUpdate.payment_status = payment_status
    } else if (status === 'cancelled') {
      regUpdate.payment_status = 'cancelled'
    } else if (status === 'confirmed' && existing.is_free) {
      regUpdate.payment_status = 'free'
    } else if (status === 'confirmed' && !existing.is_free) {
      regUpdate.payment_status = 'paid'
    }

    const { data: reg, error: updateErr } = await supabase
      .from('workshop_registrations')
      .update(regUpdate)
      .eq('id', id)
      .select('*, workshops(title)')
      .single()
    if (updateErr) throw updateErr

    if (existing.user_id) {
      const workshopTitle = existing.workshops?.title || 'the workshop'
      const isConfirmed   = status === 'confirmed'
      await supabase.from('notifications').insert({
        user_id: existing.user_id,
        title:   isConfirmed ? 'Registration Confirmed 🎉' : 'Registration Cancelled',
        message: isConfirmed
          ? `Your spot in "${workshopTitle}" is confirmed! We look forward to seeing you.`
          : `Your registration for "${workshopTitle}" has been cancelled.`,
        type:    'system',
        is_read: false,
      }).catch(e => console.warn('[notifications insert]', e.message))
    }

    res.json({ success: true, registration: reg })
  } catch (err) {
    console.error('[PATCH /workshops/admin/reg/:id]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// PATCH /api/workshops/admin/:id — update workshop
router.patch('/admin/:id', async (req, res) => {
  const { id } = req.params
  try {
    const allowed = [
      'title', 'facilitator', 'date', 'time', 'seats', 'price',
      'mode', 'tags', 'description', 'color', 'emoji', 'sort_order',
      'is_active', 'image_url',
    ]
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    )
    if (updates.seats      !== undefined) updates.seats      = Math.max(1, parseInt(updates.seats, 10) || 1)
    if (updates.price      !== undefined) updates.price      = Math.max(0, parseInt(updates.price, 10) || 0)
    if (updates.sort_order !== undefined) updates.sort_order = parseInt(updates.sort_order, 10) || 0
    updates.updated_at = new Date().toISOString()

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' })
    }

    const { data, error } = await supabase
      .from('workshops')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) {
      console.error('[PATCH /workshops/admin/:id] Supabase error:', JSON.stringify(error))
      return res.status(500).json({ success: false, error: error.message })
    }
    res.json({ success: true, workshop: data })
  } catch (err) {
    console.error('[PATCH /workshops/admin/:id]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/workshops/admin/:id — soft delete
router.delete('/admin/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('workshops')
      .update({ is_active: false })
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('[DELETE /workshops/admin/:id]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router