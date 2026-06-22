const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/staff
const listStaff = async (req, res) => {
  const { role } = req.query

 let query = supabase
  .from('staff_members')
  .select('id, full_name, phone, role, department, notes, is_active') // ← remove avatar_url
  .order('full_name')

  if (role) query = query.eq('role', role)

  const { data, error } = await query

  if (error) {
    return res.status(500).json({ success: false, message: 'Could not fetch staff.' })
  }

  return res.status(200).json({ success: true, staff: data })
}

module.exports = { listStaff }