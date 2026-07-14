const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

exports.authenticateRider = async (req, res, next) => {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ message: 'No token provided' })

    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.type !== 'rider') return res.status(401).json({ message: 'Invalid token type' })

    const { data: rider, error } = await supabase
      .from('delivery_riders')
      .select('id, full_name, email, phone, area, vehicle_type, is_active')
      .eq('id', payload.id)
      .single()

    if (error || !rider) return res.status(401).json({ message: 'Rider not found' })
    if (!rider.is_active) return res.status(403).json({ message: 'Account deactivated. Contact admin.' })

    req.rider = rider
    next()
  } catch (e) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}