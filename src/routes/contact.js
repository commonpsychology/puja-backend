// src/routes/polls.js
const express  = require('express')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const router   = express.Router()

// POST /api/polls/submit — anonymous poll submission
router.post('/submit', async (req, res) => {
  const { answers } = req.body
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ success: false, message: 'answers object is required.' })
  }

  const { error } = await supabase.from('poll_responses').insert({ answers })
  if (error) console.error('poll insert error:', error)

  return res.status(200).json({ success: true, message: 'Poll submitted. Thank you!' })
})

// GET /api/polls/results — aggregate results
router.get('/results', async (req, res) => {
  const { data, error } = await supabase.from('poll_responses').select('answers')
  if (error || !data?.length) {
    return res.status(200).json({ success: true, counts: null })
  }

  // Aggregate: counts[questionId][optionIndex] = count
  const counts = {}
  data.forEach(row => {
    Object.entries(row.answers || {}).forEach(([qid, optIdx]) => {
      if (!counts[qid]) counts[qid] = [0, 0, 0, 0]
      counts[qid][Number(optIdx)] = (counts[qid][Number(optIdx)] || 0) + 1
    })
  })

  return res.status(200).json({ success: true, counts, total: data.length })
})

module.exports = router