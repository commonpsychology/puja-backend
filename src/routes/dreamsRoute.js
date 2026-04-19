/**
 * routes/dreams.js
 * ─────────────────────────────────────────────────────────
 * POST /api/dreams        — plant a dream (auth required, one per user)
 * GET  /api/dreams/mine   — fetch the current user's dream (auth required)
 * ─────────────────────────────────────────────────────────
 */

const express = require('express')
const router  = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { authenticate } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Helper — finds the UUID from whichever field your JWT uses
function getUserId(req) {
  const u = req.user
  return u.id || u.userId || u.user_id || u.sub || u.uuid || null
}

// POST /api/dreams — plant a dream (one per user)
router.post('/', authenticate, async (req, res) => {
  const userId = getUserId(req)

  if (!userId) {
    console.error('[dreams] req.user has no id field:', req.user)
    return res.status(401).json({ success: false, message: 'Cannot resolve user id from token.' })
  }

  const { dream_text } = req.body

  if (!dream_text || !dream_text.trim()) {
    return res.status(400).json({ success: false, message: 'dream_text is required.' })
  }

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('dreams')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Dream already planted.',
        dream_id: existing.id,
      })
    }

    const { data: dream, error: insertErr } = await supabase
      .from('dreams')
      .insert({ user_id: userId, dream_text: dream_text.trim() })
      .select()
      .single()

    if (insertErr) throw insertErr

    return res.status(201).json({ success: true, dream })
  } catch (err) {
    console.error('[POST /api/dreams]', err)
    return res.status(500).json({ success: false, message: 'Server error.' })
  }
})

// GET /api/dreams/all — fetch all dreams (public, no auth needed)
router.get('/all', async (req, res) => {
  try {
    const { data: dreams, error } = await supabase
      .from('dreams')
      .select('id, dream_text, user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(60)

    if (error) throw error
    return res.status(200).json({ success: true, dreams: dreams || [] })
  } catch (err) {
    console.error('[GET /api/dreams/all]', err)
    return res.status(500).json({ success: false, message: 'Server error.' })
  }
})

// GET /api/dreams/mine — fetch current user's dream
router.get('/mine', authenticate, async (req, res) => {
  const userId = getUserId(req)

  if (!userId) {
    console.error('[dreams] req.user has no id field:', req.user)
    return res.status(401).json({ success: false, message: 'Cannot resolve user id from token.' })
  }

  try {
    const { data: dream, error } = await supabase
      .from('dreams')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error

    return res.status(200).json({ success: true, dream: dream || null })
  } catch (err) {
    console.error('[GET /api/dreams/mine]', err)
    return res.status(500).json({ success: false, message: 'Server error.' })
  }
})

module.exports = router