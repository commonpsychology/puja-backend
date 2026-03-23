/* eslint-disable no-undef */
const bcrypt = require('bcryptjs')
const { validationResult } = require('express-validator')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const safeProfile = (p) => ({
  id:              p.id,
  fullName:        p.full_name,
  displayName:     p.display_name,
  email:           p.email,
  avatarUrl:       p.avatar_url,
  phone:           p.phone,
  dateOfBirth:     p.date_of_birth,
  gender:          p.gender,
  address:         p.address,
  city:            p.city,
  country:         p.country,
  language:        p.language,
  bio:             p.bio,
  role:            p.role,
  isEmailVerified: p.is_email_verified,
  createdAt:       p.created_at,
  updatedAt:       p.updated_at,
})

// GET /api/profile
const getProfile = async (req, res) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.sub)
    .maybeSingle()

  if (error || !profile) {
    return res.status(404).json({ success: false, message: 'Profile not found.' })
  }

  return res.status(200).json({ success: true, user: safeProfile(profile) })
}

// PUT /api/profile
const updateProfile = async (req, res) => {
  const allowed = [
    'full_name','display_name','phone','date_of_birth',
    'gender','address','city','country','language','bio','emergency_contact',
  ]

  const updates = {}
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  })

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No valid fields provided.' })
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.sub)
    .select()
    .single()

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not update profile.' })
  }

  return res.status(200).json({ success: true, message: 'Profile updated.', user: safeProfile(profile) })
}

// POST /api/profile/change-password
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Both current and new password are required.' })
  }

  if (newPassword.length < 8) {
    return res.status(422).json({ success: false, message: 'New password must be at least 8 characters.' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('password_hash')
    .eq('id', req.user.sub)
    .maybeSingle()

  if (!profile) {
    return res.status(404).json({ success: false, message: 'User not found.' })
  }

  const valid = await bcrypt.compare(currentPassword, profile.password_hash)
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' })
  }

  const password_hash = await bcrypt.hash(newPassword, 12)

  await supabase.from('profiles').update({ password_hash }).eq('id', req.user.sub)

  // Revoke all refresh tokens so other devices are logged out
  await supabase.from('refresh_tokens').delete().eq('user_id', req.user.sub)

  return res.status(200).json({ success: true, message: 'Password changed successfully. Please log in again.' })
}

// POST /api/profile/avatar
const uploadAvatar = async (req, res) => {
  const { avatarUrl } = req.body

  if (!avatarUrl) {
    return res.status(400).json({ success: false, message: 'avatarUrl is required.' })
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', req.user.sub)
    .select()
    .single()

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not update avatar.' })
  }

  return res.status(200).json({ success: true, message: 'Avatar updated.', avatarUrl: profile.avatar_url })
}

// DELETE /api/profile
const deleteAccount = async (req, res) => {
  const { password } = req.body

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password confirmation is required.' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('password_hash')
    .eq('id', req.user.sub)
    .maybeSingle()

  const valid = await bcrypt.compare(password, profile.password_hash)
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Incorrect password.' })
  }

  await supabase.from('profiles').update({ is_active: false }).eq('id', req.user.sub)

  return res.status(200).json({ success: true, message: 'Account deactivated successfully.' })
}

module.exports = { getProfile, updateProfile, changePassword, uploadAvatar, deleteAccount }