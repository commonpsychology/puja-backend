// src/index.mjs
import 'dotenv/config'
import express      from 'express'
import helmet       from 'helmet'
import cors         from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit    from 'express-rate-limit'
import path         from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

import otpRoutes        from './routes/otpRoutes.mjs'

const require    = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const integrateRoutes     = require('./routes/integrateRoutes')
const errorHandler        = require('./middleware/errorHandler')
const volunteerRoutes     = require('./routes/volunteerRoutes')
const { startExpireHoldsJob } = require('./jobs/expireHolds')
const authRoutes          = require('./routes/auth')
const profileRoutes       = require('./routes/profile')
const passwordRoutes      = require('./routes/password')
const therapistsRoutes    = require('./routes/therapists')
const therapistPortal     = require('./routes/therapistRoutes')
const appointmentsRoutes  = require('./routes/appointments')
const paymentsRoutes      = require('./routes/payments')
const notificationsRoutes = require('./routes/notifications')
const contactRoutes       = require('./routes/contact')
const pollsRoutes         = require('./routes/polls')
const reviewsRoutes       = require('./routes/reviewsRoutes')
const psychRoute          = require('./routes/psychRoute')
const newsRoutes          = require('./routes/newsRoutes')
const blogRoutes          = require('./routes/blogRoute')
const researchRoutes      = require('./routes/researchRoute')
const resourcesRoutes     = require('./routes/resourcesRoute')
const galleryRoutes       = require('./routes/galleryRoute')
const communityRoutes     = require('./routes/communityRoute')
const roomBookingsRoutes  = require('./routes/roomBookings')
const diagnosticsRoutes   = require('./routes/diagnostics')
const adminRoutes         = require('./routes/admin')
const storeRoutes         = require('./routes/store')
const esewaRoutes         = require('./routes/esewaRoutes')
const staffRoutes          = require('./routes/staff')
const wellnessRoutes      = require('./routes/wellness')
const delivery=require('./routes/delivery')
const workshopRoutes      = require('./routes/workshopRoutes')
const socialWorkRoutes    = require('./routes/socialWorkRoutes')
const sharedBookingsRoutes = require('./routes/sharedBookings')
const settingsRoutes      = require('./routes/settingsRoutes')
const coursesRoute        = require('./routes/coursesRoute')
const enrollmentsRoutes   = require('./routes/enrollmentsRoute')
const playlistsRoute      = require('./routes/playlistRoute')
const attendanceRoutes    = require('./routes/attendanceRoutes')
const dreamsRouter        = require('./routes/dreamsRoute')
const patientsRoute        = require('./routes/patient')
const deliveryRoutes      = require('./routes/deliveryRoutes')
const adminProductsRoutes = require('./routes/adminProducts')
const esewaRouter         = require('./routes/esewa')
const adminDeliveryRoutes = require('./routes/admindeliveryroute')
const donationRoutes = require('./routes/donationRoutes');
const adminOrderDeliveryRoutes = require('./routes/adminOrderDelivery')
const internalRoutes = require('./routes/internal')
const adminRoomBookings   = require('./routes/adminRoomBookings')
const adminRooms          = require('./routes/adminRooms')
const roomBookingsAdmin   = require('./routes/roomBookingsAdmin')
const app  = express()
const PORT = process.env.PORT || 5000

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-eval'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "blob:", "https:"],
      connectSrc:  ["'self'", "https://puja-backend-gamma.vercel.app", "https://commonpsychology.vercel.app"],
      fontSrc:     ["'self'", "https:", "data:"],
      objectSrc:   ["'none'"],
      mediaSrc:    ["'self'"],
      frameSrc:    ["'none'"],
      frameAncestors: ["'self'", "https://commonpsychology.vercel.app"],
    },
  },
}))

app.set('trust proxy', 1)

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'https://commonpsychology.vercel.app',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true)
    else callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.options('*', cors())

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// ── Static files (local dev only) ────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use('/images', express.static(path.join(__dirname, '..', 'images')))
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests. Slow down.' },
}))

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:    'ok',
  service:   'Puja Samargi API',
  version:   '2.1.0',
  timestamp: new Date().toISOString(),
}))
// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',                 authRoutes)
app.use('/api/profile',              profileRoutes)
app.use('/api/password',             passwordRoutes)
app.use('/api/therapists',           therapistsRoutes)
app.use('/api/therapist-portal',     therapistPortal)
app.use('/api/appointments',         appointmentsRoutes)
app.use('/api/payments',             paymentsRoutes)
app.use('/api/esewa',                esewaRoutes)
app.use('/api/esewa',                esewaRouter)
app.use('/api/notifications',        notificationsRoutes)
app.use('/api/contact',              contactRoutes)
app.use('/api/delivery', require('./routes/delivery'))
app.use('/api/reviews',              reviewsRoutes)
app.use('/api/admin/delivery-riders', adminDeliveryRoutes)
app.use('/api/volunteer',            volunteerRoutes)
app.use('/api/integrate',             integrateRoutes)
app.use('/api/staff',                 staffRoutes)
app.use('/api/admin/orders',          adminOrderDeliveryRoutes)
app.use('/api/polls',                pollsRoutes)
app.use('/api/workshops',            workshopRoutes)
app.use('/api/settings',             settingsRoutes)
app.use('/api/enrollments',          enrollmentsRoutes)
app.use('/api/_diagnostics', diagnosticsRoutes)
app.use('/api/delivery',             deliveryRoutes)
app.use('/api/courses',              coursesRoute)
app.use('/api/images',               require('./routes/images'))
app.use('/api/psych',                psychRoute)
app.use('/api/otp',                  otpRoutes)
app.use('/api/bookings', sharedBookingsRoutes)


app.use('/api/attendance',           attendanceRoutes)
app.use('/api/news',                 newsRoutes)
app.use('/api/patients',             patientsRoute)
app.use('/api/dreams',               dreamsRouter)
app.use('/api/blog',                 blogRoutes)
app.use('/api/playlists',            playlistsRoute)
app.use('/api/research',             researchRoutes)
app.use('/api/resources',            resourcesRoutes)
app.use('/api/gallery',              galleryRoutes)
app.use('/api/community',            communityRoutes)
app.use('/api/room-bookings',        roomBookingsRoutes)
app.use('/api/admin',                adminRoutes)
app.use('/api/admin',                adminProductsRoutes)
app.use('/api/store',                storeRoutes)
app.use('/api/admin/room-bookings',  adminRoomBookings)
app.use('/api',                      roomBookingsAdmin)
app.use('/api/admin/rooms',          adminRooms)
app.use('/api/wellness',             wellnessRoutes)
app.use('/api/social-work-programs', socialWorkRoutes)
app.use('/api/donations',            donationRoutes)
app.use('/api/internal',             internalRoutes)

app.get('/api/mood', (_req, res) => res.json({ success: true, moods: [] }))

// ── 404 & error handler ───────────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, message: `${req.method} ${req.path} not found.` })
)
app.use(errorHandler)

// ── Start server (local dev only) ─────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀  Common Psychology API v2.1 — port ${PORT}`)
    console.log(`   Mode   : ${process.env.NODE_ENV || 'development'}`)
    console.log(`   Health : http://localhost:${PORT}/health\n`)
  })
  startExpireHoldsJob()
}

export default app
