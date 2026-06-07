import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { generateCounselorId } from '../services/memberIdGen.js'
import { generateSetupToken, sendSetupEmail } from '../services/email.js'

const router = express.Router()
router.use(authMiddleware, requireRole('admin', 'counselor'))

// GET /api/counselors
router.get('/', async (req, res) => {
  try {
    const { data: counselors, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'counselor')
      .order('created_at')

    if (error) return res.status(400).json({ error: error.message })

    // Attach stats to each counselor
    const enriched = await Promise.all(counselors.map(async (c) => {
      const [{ count: studentCount }, { data: sessions }] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('counselor_id', c.id),
        supabase.from('sessions').select('rating').eq('counselor_id', c.id).not('rating', 'is', null)
      ])
      const avgRating = sessions?.length
        ? (sessions.reduce((s, x) => s + x.rating, 0) / sessions.length).toFixed(1)
        : null

      return { ...c, student_count: studentCount || 0, avg_rating: avgRating }
    }))

    res.json(enriched)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/counselors
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, email, phone } = req.body
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' })

    const member_id = await generateCounselorId(supabase)

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      password: `Temp${Math.random().toString(36).slice(2)}!`
    })
    if (authErr) return res.status(400).json({ error: authErr.message })

    const { data, error } = await supabase.from('users').insert({
      id: authUser.user.id,
      member_id,
      name,
      email,
      phone,
      role: 'counselor',
      password_set: false,
      is_active: true
    }).select().single()

    if (error) {
      await supabase.auth.admin.deleteUser(authUser.user.id)
      return res.status(400).json({ error: error.message })
    }

    const token = generateSetupToken(email, member_id)
    try { await sendSetupEmail(name, email, member_id, token) } catch (e) {
      console.error('Email failed:', e.message)
    }

    res.status(201).json({ counselor: data, setup_token: token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/counselors/:id
router.get('/:id', async (req, res) => {
  try {
    const { data: c, error } = await supabase
      .from('users').select('*').eq('id', req.params.id).eq('role', 'counselor').single()
    if (error || !c) return res.status(404).json({ error: 'Counselor not found' })

    const [{ count: studentCount }, { data: sessions }] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('counselor_id', c.id),
      supabase.from('sessions').select('rating').eq('counselor_id', c.id).not('rating', 'is', null)
    ])
    const avgRating = sessions?.length
      ? (sessions.reduce((s, x) => s + x.rating, 0) / sessions.length).toFixed(1) : null

    res.json({ ...c, student_count: studentCount || 0, avg_rating: avgRating })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/counselors/:id/permissions  (admin only)
router.put('/:id/permissions', requireRole('admin'), async (req, res) => {
  try {
    const { permissions } = req.body
    if (!permissions || typeof permissions !== 'object')
      return res.status(400).json({ error: 'permissions object required' })

    const { data, error } = await supabase
      .from('users').update({ permissions }).eq('id', req.params.id).eq('role', 'counselor')
      .select().single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/counselors/:id/status  (admin only)
router.put('/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const { is_active } = req.body
    const { data, error } = await supabase
      .from('users').update({ is_active }).eq('id', req.params.id).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/counselors/:id/students
router.get('/:id/students', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*, user:users!students_user_id_fkey(name, email, phone, member_id)')
      .eq('counselor_id', req.params.id)
      .order('created_at')

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/counselors/:id/stats
router.get('/:id/stats', async (req, res) => {
  try {
    const [
      { count: students },
      { count: sessions },
      { data: ratings },
      { count: lists }
    ] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('counselor_id', req.params.id),
      supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('counselor_id', req.params.id),
      supabase.from('sessions').select('rating').eq('counselor_id', req.params.id).not('rating', 'is', null),
      supabase.from('pref_lists').select('*', { count: 'exact', head: true }).eq('uploaded_by', req.params.id)
    ])

    const avgRating = ratings?.length
      ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)
      : null

    res.json({ students, sessions, lists, avg_rating: avgRating })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
