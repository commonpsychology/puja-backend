// src/routes/contact.js
const express = require('express')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const router = express.Router()

const VALID_TYPES = ['general', 'appointment', 'support', 'complaint', 'feedback']

// POST /api/contact — public contact form submission
router.post('/', async (req, res) => {
  const { name, email, phone, subject, message, type } = req.body

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Name, email, and message are required.' })
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRe.test(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' })
  }

  const safeType = VALID_TYPES.includes(type) ? type : 'general'

  const { data, error } = await supabase
    .from('contact_messages')
    .insert({
      name,
      email,
      phone: phone || null,
      subject: subject || null,
      message,
      type: safeType,
    })
    .select()
    .single()

  if (error) {
    console.error('contact insert error:', error)
    return res.status(500).json({ success: false, message: 'Could not save your message. Please try again.' })
  }

  return res.status(200).json({ success: true, message: 'Message received. Thank you!', data })
})

// GET /api/contact — list messages (for admin dashboard use)
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('contact fetch error:', error)
    return res.status(500).json({ success: false, message: 'Could not load messages.' })
  }

  return res.status(200).json({ success: true, data })
})

module.exports = router