// server/routes/polls.js
//
// Mount with: app.use('/api/polls', require('./routes/polls'))
//
// Requires:
//   - your existing JWT auth middleware (authenticate) that sets req.user = { sub, email, role }
//     (sub = the user's profile id — see authController.js login/getMe)
//   - an optional-auth variant (optionalAuth) that sets req.user if a valid
//     token is present, but does NOT 401 if it's missing
//
// Env vars expected:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   <-- service role, server-side ONLY, never ship to client

const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const router = express.Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const POLL_KEY = 'homepage_poll'

const { authenticate, optionalAuth } = require('../middleware/auth')

// ── GET /api/polls/has-answered ───────────────────────────────
// Logged-in only. Returns { answered: boolean }.
router.get('/has-answered', authenticate, async (req, res) => {
  try {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' })
    }

    const { data, error } = await supabase
      .from('poll_responses')
      .select('id')
      .eq('user_id', userId)
      .eq('poll_key', POLL_KEY)
      .maybeSingle()

    if (error) throw error

    res.json({ answered: !!data })
  } catch (err) {
    console.error('has-answered error:', err)
    res.status(500).json({ message: 'Could not check poll status' })
  }
})

// ── POST /api/polls/submit ────────────────────────────────────
// Logged-in only (poll is now gated behind login, per product decision).
// Body: { answers: { q1: 0, q2: 2, q3: 1, q4: 3, q5: 0 } }
router.post('/submit', authenticate, async (req, res) => {
  const { answers } = req.body
  const userId = req.user?.sub

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' })
  }

  if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
    return res.status(400).json({ message: 'Missing answers' })
  }

  try {
    // Insert the response. Unique (user_id, poll_key) constraint
    // means a second submit attempt fails safely instead of double-counting.
    const { error: insertError } = await supabase
      .from('poll_responses')
      .insert({
        user_id: userId,
        poll_key: POLL_KEY,
        answers,
      })

    if (insertError) {
      // 23505 = unique_violation -> user already answered, treat as idempotent success
      if (insertError.code === '23505') {
        return res.json({ ok: true, alreadyAnswered: true })
      }
      throw insertError
    }

    // Bump aggregate counts (best-effort; don't fail the request over this)
    const { error: rpcError } = await supabase.rpc('increment_poll_counts', {
      p_poll_key: POLL_KEY,
      p_answers: answers,
    })
    if (rpcError) console.error('increment_poll_counts error:', rpcError)

    res.json({ ok: true })
  } catch (err) {
    console.error('poll submit error:', err)
    res.status(500).json({ message: 'Could not submit poll' })
  }
})

// ── GET /api/polls/results ────────────────────────────────────
// Public-ish (no login required to view aggregate results in the UI).
// Returns { counts: { q1: [n,n,n,n], q2: [...], ... } }
router.get('/results', optionalAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('poll_counts')
      .select('question_id, option_idx, count')
      .eq('poll_key', POLL_KEY)

    if (error) throw error

    const counts = {}
    for (const row of data) {
      if (!counts[row.question_id]) counts[row.question_id] = [0, 0, 0, 0]
      counts[row.question_id][row.option_idx] = row.count
    }

    res.json({ counts })
  } catch (err) {
    console.error('poll results error:', err)
    res.status(500).json({ message: 'Could not load poll results' })
  }
})

module.exports = router