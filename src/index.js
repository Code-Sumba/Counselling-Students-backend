import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import authRoutes from './routes/auth.js'
import studentRoutes from './routes/students.js'
import documentRoutes from './routes/documents.js'
import preflistRoutes from './routes/preflists.js'
import sessionRoutes from './routes/sessions.js'
import notificationRoutes from './routes/notifications.js'
import counselorRoutes from './routes/counselors.js'
import adminRoutes from './routes/admin.js'

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

app.use('/api/auth', authRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/preflists', preflistRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/counselors', counselorRoutes)
app.use('/api/admin', adminRoutes)

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`MindzSpark backend running on port ${PORT}`)
})
