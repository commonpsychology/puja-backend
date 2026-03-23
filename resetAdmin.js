/* resetAdmin.js — run once, then DELETE this file
   Usage: node resetAdmin.js
*/
require('dotenv').config()
const bcrypt       = require('bcryptjs')
const { createClient } = require('@supabase/supabase-js')

const EMAIL       = 'admin@pujasamargi.com.np'
const NEW_PASSWORD = process.env.ADMIN_RESET_PASSWORD

if (!NEW_PASSWORD) {
  console.error('❌  Set ADMIN_RESET_PASSWORD in your .env before running this script.')
  process.exit(1)
}

if (NEW_PASSWORD.length < 12) {
  console.error('❌  Password must be at least 12 characters.')
  process.exit(1)
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function run() {
  // 1. Confirm the profile exists
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, is_active')
    .eq('email', EMAIL)
    .maybeSingle()

  if (fetchError || !profile) {
    console.error('❌  Profile not found or Supabase error:', fetchError?.message)
    process.exit(1)
  }

  console.log(`✅  Profile found: ${profile.email} (active: ${profile.is_active})`)

  // 2. Hash the new password with bcryptjs (same lib your authController uses)
  const password_hash = await bcrypt.hash(NEW_PASSWORD, 12)
  console.log('✅  Password hashed — prefix:', password_hash.slice(0, 7))  // should be $2a$12

  // 3. Update the profile
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ password_hash })
    .eq('id', profile.id)

  if (updateError) {
    console.error('❌  Update failed:', updateError.message)
    process.exit(1)
  }

  // 4. Invalidate all existing sessions for this user
  const { error: revokeError } = await supabase
    .from('refresh_tokens')
    .delete()
    .eq('user_id', profile.id)

  if (revokeError) {
    console.warn('⚠️   Could not revoke existing sessions:', revokeError.message)
  } else {
    console.log('✅  All existing sessions revoked.')
  }

  console.log('✅  Password updated successfully. You can now log in.')
  console.log('⚠️   IMPORTANT: Remove ADMIN_RESET_PASSWORD from your .env and delete this script.')
}

run()