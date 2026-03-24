const jwt = require('jsonwebtoken')

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided.' })
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    console.log('✅ Token decoded:', decoded)  // ← ADD THIS
    req.user = decoded
    next()
  } catch (err) {
    console.log('❌ Token error:', err.message)  // ← ADD THIS
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' })
  }
}


module.exports = { authenticate }