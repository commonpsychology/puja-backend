// ============================================================
// BACKEND: src/services/api.js  — add this to your admin object
// ============================================================

// Add this function inside your existing `admin` export object:
//
//   export const admin = {
//     ...existingFunctions,
//     registerStaff,        // ← add this line
//   }

export async function registerStaff(payload) {
  // payload shape:
  // {
  //   full_name: string,
  //   email: string,
  //   phone: string | null,
  //   password: string,
  //   role: 'staff' | 'therapist' | 'admin',
  //   department: string | null,
  //   notes: string | null,
  // }
  const res = await fetch('/api/admin/register-staff', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // If you use JWT/session tokens, attach here:
      // 'Authorization': `Bearer ${getToken()}`,
    },
    credentials: 'include', // sends cookies (for session-based auth)
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Failed to register staff')
  return data
}


// ============================================================
// BACKEND ROUTE: Express.js  (Node / Next.js API route)
// Place at:  src/api/admin/register-staff.js   (Next.js pages/api)
//        or:  routes/admin.js                  (Express)
// ============================================================

import bcrypt from 'bcryptjs'
import { supabase } from '../../lib/supabase'   // adjust path to your DB client

// ── Auth middleware helper (inline example) ──────────────────
function requireAdmin(req) {
  // Replace this with your actual session/JWT check.
  // Should return the logged-in user object or throw.
  const user = req.user  // set by your auth middleware
  if (!user) throw { status: 401, message: 'Not authenticated.' }
  if (!['admin', 'staff'].includes(user.role)) {
    throw { status: 403, message: 'Access denied. Admin only.' }
  }
  return user
}

// ── Route handler ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed.' })
  }

  try {
    // 1. Auth guard
    requireAdmin(req)

    // 2. Validate payload
    const { full_name, email, phone, password, role, department, notes } = req.body

    if (!full_name?.trim())  return res.status(400).json({ message: 'Full name is required.' })
    if (!email?.trim())      return res.status(400).json({ message: 'Email is required.' })
    if (!password)           return res.status(400).json({ message: 'Password is required.' })
    if (!['staff', 'therapist', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role.' })
    }
    if (password.length < 8) return res.status(400).json({ message: 'Password too short.' })

    const normalizedEmail = email.trim().toLowerCase()

    // 3. Check for duplicate email
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .single()

    if (existing) {
      return res.status(409).json({ message: 'A user with this email already exists.' })
    }

    // 4. Hash password
    const password_hash = await bcrypt.hash(password, 12)

    // 5. Insert into profiles table
    const { data: newUser, error: insertError } = await supabase
      .from('profiles')
      .insert({
        full_name:     full_name.trim(),
        email:         normalizedEmail,
        phone:         phone?.trim() || null,
        password_hash,
        role,
        department:    department?.trim() || null,
        notes:         notes?.trim() || null,
        is_active:     true,
        email_verified: true,   // staff accounts are pre-verified
        created_by:    req.user?.id || null,
      })
      .select('id, full_name, email, role, created_at')
      .single()

    if (insertError) {
      console.error('Insert error:', insertError)
      return res.status(500).json({ message: 'Database error. Please try again.' })
    }

    // 6. (Optional) Log the action in audit_logs
    await supabase.from('audit_logs').insert({
      actor_id:   req.user?.id,
      action:     'register_staff',
      target_id:  newUser.id,
      details:    { role, department },
    }).throwOnError().catch(() => {})  // non-blocking

    // 7. (Optional) Send welcome email — replace with your mailer
    // await sendWelcomeEmail({ to: normalizedEmail, name: full_name, role, password })

    return res.status(201).json({
      message: 'Staff member registered successfully.',
      user: newUser,
    })

  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error('register-staff error:', err)
    return res.status(500).json({ message: 'Internal server error.' })
  }
}