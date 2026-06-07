import express from 'express'
import jwt from 'jsonwebtoken'
import { supabase, supabaseAnon } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { generateSetupToken, verifySetupToken, sendSetupEmail, sendLoginOtpEmail } from '../services/email.js'

const router = express.Router()

// In-memory OTP stores
const otpStore = new Map()      // password-reset OTPs
const loginOtpStore = new Map() // login verification OTPs

// POST /api/auth/login  — step 1: verify credentials, send OTP
router.post('/login', async (req, res) => {
  try {
    const { memberId, password } = req.body
    if (!memberId || !password) return res.status(400).json({ error: 'Member ID / email and password required' })

    const identifier = memberId.trim()
    const isEmail = identifier.includes('@')

    const { data: dbUser, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq(isEmail ? 'email' : 'member_id', isEmail ? identifier.toLowerCase() : identifier.toUpperCase())
      .maybeSingle()

    if (userErr || !dbUser) {
      console.log(`[LOGIN FAIL] user lookup failed for ${identifier}:`, userErr?.message || 'not found')
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (!dbUser.is_active) return res.status(401).json({ error: 'Account is deactivated' })

    const { data: authData, error: authErr } = await supabaseAnon.auth.signInWithPassword({
      email: dbUser.email,
      password
    })

    if (authErr) {
      console.log(`[LOGIN FAIL] signInWithPassword failed for ${dbUser.email}:`, authErr.message)
      return res.status(401).json({ error: 'Invalid Member ID or password' })
    }

    const userPayload = {
      id: dbUser.id,
      memberId: dbUser.member_id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
      phone: dbUser.phone
    }

    // Admin bypasses OTP — return token directly
    if (dbUser.role === 'admin') {
      await supabase.from('activity_log').insert({
        actor_id: dbUser.member_id,
        actor_role: dbUser.role,
        action: 'LOGIN',
        details: { memberId: dbUser.member_id },
        ip_address: req.ip
      })
      return res.json({ access_token: authData.session.access_token, user: userPayload })
    }

    // Non-admin: generate OTP and store session temporarily
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const key = dbUser.member_id
    loginOtpStore.set(key, {
      otp,
      expires: Date.now() + 10 * 60 * 1000,
      session: authData.session,
      user: userPayload
    })

    console.log(`[LOGIN OTP] ${key}: ${otp}`)
    try {
      await sendLoginOtpEmail(dbUser.name, dbUser.email, otp)
    } catch (emailErr) {
      console.error('Login OTP email failed:', emailErr.message)
    }

    const maskedEmail = dbUser.email.replace(/(.{2}).*(@.*)/, '$1***$2')
    res.json({ requires_otp: true, email: maskedEmail, memberId: key })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/verify-login-otp  — step 2: verify OTP, return session
router.post('/verify-login-otp', async (req, res) => {
  try {
    const { memberId, otp } = req.body
    const key = memberId?.toUpperCase()
    const stored = loginOtpStore.get(key)

    if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'Invalid or expired verification code' })
    }

    loginOtpStore.delete(key)

    // Log activity
    await supabase.from('activity_log').insert({
      actor_id: key,
      actor_role: stored.user.role,
      action: 'LOGIN',
      details: { memberId: key },
      ip_address: req.ip
    })

    res.json({
      access_token: stored.session.access_token,
      user: stored.user
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/setup-password
router.post('/setup-password', async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' })
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })

    let payload
    try {
      payload = verifySetupToken(token)
    } catch {
      return res.status(400).json({ error: 'Invalid or expired setup link' })
    }

    const { data: dbUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', payload.email)
      .single()

    if (!dbUser) return res.status(404).json({ error: 'User not found' })

    const { error: updateErr } = await supabase.auth.admin.updateUserById(dbUser.id, { password })
    if (updateErr) return res.status(400).json({ error: updateErr.message })

    await supabase.from('users').update({ password_set: true }).eq('id', dbUser.id)

    res.json({ message: 'Password set successfully' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { memberId } = req.body
    if (!memberId) return res.status(400).json({ error: 'Member ID required' })

    const { data: dbUser } = await supabase
      .from('users')
      .select('*')
      .eq('member_id', memberId.trim().toUpperCase())
      .single()

    if (!dbUser) return res.status(404).json({ error: 'Member ID not found' })

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    otpStore.set(memberId.toUpperCase(), { otp, expires: Date.now() + 10 * 60 * 1000 })

    // In production, send email. For now, log to console.
    console.log(`OTP for ${memberId}: ${otp}`)

    res.json({ message: 'OTP sent to registered email', email: dbUser.email.replace(/(.{2}).*(@.*)/, '$1***$2') })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { memberId, otp } = req.body
    const key = memberId?.toUpperCase()
    const stored = otpStore.get(key)

    if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
      return res.status(400).json({ error: 'Invalid or expired OTP' })
    }

    otpStore.delete(key)

    const { data: dbUser } = await supabase
      .from('users')
      .select('email, member_id')
      .eq('member_id', key)
      .single()

    const resetToken = generateSetupToken(dbUser.email, dbUser.member_id)
    res.json({ token: resetToken })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    id: req.user.id,
    memberId: req.user.member_id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    phone: req.user.phone
  })
})

export default router
