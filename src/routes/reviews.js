// src/routes/reviews.js
const express  = require('express')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const router = express.Router()

// GET /api/reviews — public, for Testimonials component
router.get('/', async (req, res) => {
  const { limit = 5 } = req.query

  const { data, error } = await supabase
    .from('reviews')
    .select(`
      id, rating, content, title, created_at,
      profiles:reviewer_id ( full_name, avatar_url )
    `)
    .eq('is_approved', true)
    .order('created_at', { ascending: false })
    .limit(Number(limit))

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not fetch reviews.' })
  }

  return res.status(200).json({ success: true, reviews: data })
})

module.exports = router