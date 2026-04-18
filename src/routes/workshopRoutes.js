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
// ⚠️ MUST be before /:id or Express will treat "my-registrations" as an id
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

    const { data: existing } = await supabase
      .from('workshop_registrations')
      .select('id, payment_status')
      .eq('workshop_id', workshop_id)
      .eq('attendee_email', attendee_email)
      .maybeSingle()
    if (existing) {
      return res.status(409).json({ success: false, error: 'Already registered with this email', registration: existing })
    }

    const isFree = ws.price === 0
    const { data, error } = await supabase
      .from('workshop_registrations')
      .insert({
        workshop_id,
        attendee_name,
        attendee_email,
        attendee_phone,
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
router.patch('/registration/:id/payment', async (req, res) => {
  const { payment_status, payment_ref } = req.body
  try {
    const { data, error } = await supabase
      .from('workshop_registrations')
      .update({ payment_status, payment_ref })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, registration: data })
  } catch (err) {
    console.error('[PATCH /workshops/registration/:id/payment]', err.message)
    res.status(500).json({ success: false, error: 'Failed to update payment' })
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
      'mode', 'tags', 'description', 'color', 'emoji', 'sort_order', 'is_active',
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

// PATCH /api/workshops/admin/reg/:id — confirm or cancel a registration
// Declared BEFORE /admin/:id so Express never mistakes "reg" for a workshop id
router.patch('/admin/reg/:id', async (req, res) => {
  const { status } = req.body
  const { id }     = req.params

  const allowed = ['confirmed', 'cancelled', 'pending']
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Allowed: ${allowed.join(', ')}` })
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

    const regUpdate = { status }
    if (status === 'cancelled') regUpdate.payment_status = 'cancelled'
    if (status === 'confirmed' && existing.is_free) regUpdate.payment_status = 'free'

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
          : `Your registration for "${workshopTitle}" has been cancelled. Contact us if this was unexpected.`,
        type:    'system',
        is_read: false,
      })
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
      'mode', 'tags', 'description', 'color', 'emoji', 'sort_order', 'is_active',
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