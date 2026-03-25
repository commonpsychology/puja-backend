// pages/api/admin/register-staff.js
import bcrypt from 'bcryptjs'
import { supabase } from '../db/supabase' // ← adjust if your path differs

// ── Auth guard ────────────────────────────────────────────────────────────────
// Reads the JWT from the Authorization header and validates it via Supabase.
// Returns the user object or throws with an HTTP status.
async function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) throw { status: 401, message: 'Not authenticated.' }

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) throw { status: 401, message: 'Invalid or expired session.' }

  // Fetch the role from your profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'staff'].includes(profile.role)) {
    throw { status: 403, message: 'Access denied. Admin or staff only.' }
  }

  return { ...user, role: profile.role }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    // 1. Auth guard
    const actor = await getAuthUser(req)

    // 2. Validate payload
    const { full_name, email, phone, password, role, department, notes } = req.body

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

    // 3. Check for duplicate email in profiles table
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

    // 5. Insert into profiles table
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
        email_verified: true,   // staff accounts are pre-verified by admin
        created_by:     actor.id,
      })
      .select('id, full_name, email, role, created_at')
      .single()

    if (insertError) {
      console.error('[register-staff] Insert error:', insertError)
      // Surface Supabase constraint violations clearly
      if (insertError.code === '23505') {
        return res.status(409).json({ message: 'A user with this email already exists.' })
      }
      return res.status(500).json({ message: 'Database error. Please try again.' })
    }

    // 6. Write to audit_logs (non-blocking — failure won't break registration)
    supabase.from('audit_logs').insert({
      actor_id:  actor.id,
      action:    'register_staff',
      target_id: newUser.id,
      details:   { role, department: department?.trim() || null },
    }).then(({ error }) => {
      if (error) console.warn('[register-staff] Audit log failed:', error.message)
    })

    // 7. (Optional) Send welcome email — uncomment & replace with your mailer
    // await sendWelcomeEmail({ to: normalizedEmail, name: full_name.trim(), role, password })

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