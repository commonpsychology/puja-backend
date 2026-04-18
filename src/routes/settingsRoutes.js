// src/routes/settingsRoutes.js
const express    = require('express')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const router = express.Router()

// GET /api/settings/public — no auth required
router.get('/public', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('key, value')

    if (error) throw error

    res.json({ success: true, settings: data })
  } catch (err) {
    console.error('Settings fetch error:', err)
    res.status(500).json({ success: false, message: 'Could not load settings.' })
  }
})

module.exports = router