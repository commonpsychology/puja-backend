// ============================================================
// backend/routes/patients.js
// Mount in your Express app:  app.use('/api/patients', require('./routes/patients'))
// Assumes you have:
//   - supabase client at ../lib/supabase
//   - verifyToken middleware at ../middleware/auth
// ============================================================

const express  = require('express')
const router   = express.Router()
const { supabase } = require('../db/supabase')      // adjust path
const verifyToken  = require('../middleware/auth')   // adjust path

// ── GET /api/patients  — list all patients (newest first) ───
router.get('/', verifyToken, async (req, res) => {
  try {
    const { date, search, limit = 50, offset = 0 } = req.query

    let query = supabase
      .from('patients')
      .select('*')
      .order('registered_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    // Filter by date (YYYY-MM-DD)
    if (date) {
      query = query
        .gte('registered_at', `${date}T00:00:00`)
        .lte('registered_at', `${date}T23:59:59`)
    }

    // Search by name or phone
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`)
    }

    const { data, error, count } = await query
    if (error) throw error

    res.json({ patients: data, total: count })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── POST /api/patients  — register new patient ──────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      full_name, date_of_birth, gender,
      address, phone, complaints
    } = req.body

    if (!full_name || !date_of_birth || !gender || !address || !complaints) {
      return res.status(400).json({ message: 'Missing required fields.' })
    }

    const { data, error } = await supabase
      .from('patients')
      .insert([{
        full_name,
        date_of_birth,
        gender,
        address,
        phone:         phone || null,
        complaints,
        registered_by: req.user?.id || null,
      }])
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ patient: data })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/patients/:id  — single patient ─────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ message: 'Patient not found.' })
    res.json({ patient: data })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── PATCH /api/patients/:id/status  — update status ─────────
router.patch('/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body
    if (!['active','discharged','follow-up'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' })
    }
    const { data, error } = await supabase
      .from('patients')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ patient: data })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router