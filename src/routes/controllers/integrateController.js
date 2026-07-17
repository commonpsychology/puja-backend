// integrateController.js
// Backend controller — use this if you'd rather submit the form through your own
// API instead of inserting from the browser directly. Requires the SERVICE ROLE
// key (never expose this key to the frontend).

const { createClient } = require('@supabase/supabase-js')

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SEX_OPTIONS = ['Female', 'Male', 'Non-binary', 'Prefer not to say']

function validatePayload(body) {
  const errors = {}
  const { fullName, age, sex, email, contribution } = body

  if (!fullName || String(fullName).trim().length < 2) {
    errors.fullName = 'Tell us your name.'
  }
  const ageNum = Number(age)
  if (!age || Number.isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
    errors.age = 'Enter a valid age.'
  }
  if (!sex || !SEX_OPTIONS.includes(sex)) {
    errors.sex = 'Pick one.'
  }
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    errors.email = 'Enter a valid email.'
  }
  if (contribution !== undefined && contribution !== '' && Number(contribution) < 0) {
    errors.contribution = "Contribution can't be negative."
  }
  return errors
}

// POST /api/integrate
async function createIntegration(req, res) {
  const errors = validatePayload(req.body)
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ ok: false, errors })
  }

  const { fullName, age, sex, email, phone, country, message, contribution } = req.body

  const { data, error } = await supabaseAdmin
    .from('integrate')
    .insert({
      full_name: String(fullName).trim(),
      age: Number(age),
      sex,
      email: String(email).trim().toLowerCase(),
      phone: phone ? String(phone).trim() : null,
      country: country ? String(country).trim() : null,
      message: message ? String(message).trim() : null,
      contribution_amount: contribution === undefined || contribution === '' ? 0 : Number(contribution),
    })
    .select('id, full_name, email, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, message: 'That email already joined.' })
    }
    // eslint-disable-next-line no-console
    console.error('integrate insert failed:', error)
    return res.status(500).json({ ok: false, message: 'Could not save your details. Please try again.' })
  }

  return res.status(201).json({ ok: true, member: data })
}

// GET /api/integrate  (admin use — protect this route with your own auth middleware)
async function listIntegrations(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1)
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 200)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabaseAdmin
    .from('integrate')
    .select('id, full_name, age, sex, email, phone, country, message, contribution_amount, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    // eslint-disable-next-line no-console
    console.error('integrate list failed:', error)
    return res.status(500).json({ ok: false, message: 'Could not load members.' })
  }

  return res.json({ ok: true, page, pageSize, total: count, members: data })
}

module.exports = { createIntegration, listIntegrations }