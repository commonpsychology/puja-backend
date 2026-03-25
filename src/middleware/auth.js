const jwt = require('jsonwebtoken')

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided.' })
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    console.log('✅ Token decoded:', decoded)
    req.user = decoded
    next()
  } catch (err) {
    console.log('❌ Token error:', err.message)
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' })
  }
}

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null
    return next() // no token = continue as guest
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
  } catch {
    req.user = null // invalid token = treat as guest, don't block
  }
  next()
}

module.exports = { authenticate, optionalAuth }