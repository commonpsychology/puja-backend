// pages/api/admin/register-staff.js  (or your Express equivalent)
// ─────────────────────────────────────────────────────────────
// Changes from original:
//   1. Auth guard uses your custom JWT middleware pattern instead of
//      supabase.auth.getUser() — which only works with Supabase Auth tokens.
//   2. After inserting into profiles, automatically inserts into therapists
//      table when role === 'therapist', so the portal can find the record.
//   3. Detailed inline comments on every change.
// ─────────────────────────────────────────────────────────────

const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role bypasses RLS
)

// ── Auth guard ────────────────────────────────────────────────
// FIX 1: Your app uses custom JWTs (signed with JWT_SECRET), NOT Supabase
// Auth tokens. supabase.auth.getUser() only works with Supabase-issued
// tokens, so it always fails here → 403. Use jsonwebtoken.verify() instead.
async function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) throw { status: 401, message: 'Not authenticated.' }

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    throw { status: 401, message: 'Invalid or expired session.' }
  }

  // Fetch fresh role from DB — never trust the token's role claim alone
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', decoded.userId || decoded.id || decoded.sub)
    .single()

  if (error || !profile) throw { status: 401, message: 'User not found.' }
  if (!profile.is_active)  throw { status: 403, message: 'Account is inactive.' }

  if (!['admin', 'staff'].includes(profile.role)) {
    throw { status: 403, message: 'Access denied. Admin or staff only.' }
  }

  return profile
}

// ── Route handler ─────────────────────────────────────────────
// This works for both Next.js API routes (req/res) and Express handlers.
async function handler(req, res) {
  // Express: remove this block and use router.post('/register-staff', handler)
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    // 1. Auth guard — now uses custom JWT
    const actor = await getAuthUser(req)

    // 2. Validate payload
    const {
      full_name,
      email,
      phone,
      password,
      role,
      department,
      notes,
      specialization,   // sent by RegisterStaffPage for therapists
    } = req.body

    if (!full_name?.trim())
      return res.status(400).json({ message: 'Full name is required.' })
    if (!email?.trim())
      return res.status(400).json({ message: 'Email is required.' })
    if (!password)
      return res.status(400).json({ message: 'Password is required.' })
    if (!['staff', 'therapist', 'admin'].includes(role))
      return res.status(400).json({ message: 'Invalid role.' })
    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' })
    if (!/[A-Z]/.test(password))
      return res.status(400).json({ message: 'Password needs at least one uppercase letter.' })
    if (!/[0-9]/.test(password))
      return res.status(400).json({ message: 'Password needs at least one number.' })

    const normalizedEmail = email.trim().toLowerCase()

    // 3. Check for duplicate email
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (existing) {
      return res.status(409).json({ message: 'A user with this email already exists.' })
    }

    // 4. Hash password
    const password_hash = await bcrypt.hash(password, 12)

    // 5. Insert into profiles
    const { data: newUser, error: insertError } = await supabase
      .from('profiles')
      .insert({
        full_name:      full_name.trim(),
        email:          normalizedEmail,
        phone:          phone?.trim() || null,
        password_hash,
        role,
        department:     department?.trim() || null,
        notes:          notes?.trim() || null,
        is_active:      true,
        is_email_verified: true,  // pre-verified by admin
        created_by:     actor.id,
      })
      .select('id, full_name, email, role, created_at')
      .single()

    if (insertError) {
      console.error('[register-staff] Insert error:', insertError)
      if (insertError.code === '23505') {
        return res.status(409).json({ message: 'A user with this email already exists.' })
      }
      return res.status(500).json({ message: 'Database error. Please try again.' })
    }

    // ─────────────────────────────────────────────────────────
    // FIX 2: Auto-create the therapists table row.
    //
    // The original code only inserted into profiles. The therapist portal
    // queries the therapists table (joined on user_id). Without this row,
    // every newly registered therapist sees "Therapist profile not found"
    // and the /appointments endpoint returns 404.
    // ─────────────────────────────────────────────────────────
    if (role === 'therapist') {
      const { error: therapistError } = await supabase
        .from('therapists')
        .insert({
          user_id:          newUser.id,
          is_available:     true,
          is_verified:      false,   // admin can verify later
          session_duration: 60,
          // Map the specialization dropdown value from RegisterStaffPage
          // to the specializations array used by the therapists table
          specializations:  specialization ? [specialization] : [],
        })

      if (therapistError) {
        // Log but don't fail the whole request — the profile was created.
        // The admin can fix the therapists row manually if needed.
        console.error('[register-staff] therapists insert error:', therapistError)
      }
    }

    // 6. Audit log (non-blocking)
    supabase.from('audit_logs').insert({
      actor_id:  actor.id,
      action:    'register_staff',
      target_id: newUser.id,
      details:   { role, department: department?.trim() || null },
    }).then(({ error }) => {
      if (error) console.warn('[register-staff] Audit log failed:', error.message)
    })

    return res.status(201).json({
      message: 'Staff member registered successfully.',
      user: newUser,
    })

  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message })
    }
    console.error('[register-staff] Unexpected error:', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
}

module.exports = handler
// Next.js: export default handler