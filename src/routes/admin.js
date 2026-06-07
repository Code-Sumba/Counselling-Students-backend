import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, requirePermission } from '../middleware/auth.js'

const router = express.Router()
router.use(authMiddleware, requireRole('admin'))

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [
      { count: total },
      { count: active },
      { count: admitted },
      { count: sessionsWeek },
      { data: payments }
    ] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('status', 'Active'),
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('status', 'Admitted'),
      supabase.from('sessions').select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('students').select('payment_amount').not('payment_amount', 'is', null)
    ])

    const revenue = payments?.reduce((s, p) => s + (p.payment_amount || 0), 0) || 0

    // Stage breakdown
    const { data: stageData } = await supabase
      .from('students').select('stage')
    const stageCounts = Array(6).fill(0)
    stageData?.forEach(s => { if (s.stage >= 0 && s.stage <= 5) stageCounts[s.stage]++ })

    // Category mix
    const { data: catData } = await supabase.from('students').select('category')
    const catMap = {}
    catData?.forEach(s => { catMap[s.category || 'Unknown'] = (catMap[s.category || 'Unknown'] || 0) + 1 })

    res.json({
      total, active, admitted, sessions_week: sessionsWeek, revenue,
      stage_breakdown: stageCounts,
      category_mix: catMap
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/activity
router.get('/activity', async (req, res) => {
  try {
    const { action, actor_role, limit = 50, offset = 0 } = req.query
    let query = supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (action) query = query.eq('action', action)
    if (actor_role) query = query.eq('actor_role', actor_role)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/announcements
router.get('/announcements', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/announcements
router.post('/announcements', async (req, res) => {
  try {
    const { title, message, type, target_role, expires_at, link } = req.body
    const { data, error } = await supabase
      .from('announcements')
      .insert({ title, message, type, target_role, expires_at, link: link || null, created_by: req.user.member_id })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/admin/announcements/:id
router.put('/announcements/:id', async (req, res) => {
  try {
    const { title, message, type, target_role, is_active, expires_at, link } = req.body
    const { data, error } = await supabase
      .from('announcements')
      .update({ title, message, type, target_role, is_active, expires_at, link: link !== undefined ? link : undefined })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/timeline
router.get('/timeline', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cap_timeline')
      .select('*')
      .order('display_order')

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/timeline
router.post('/timeline', async (req, res) => {
  try {
    const { event_name, event_date, description, notes, alert_message,
      important_message, changes, link, display_order } = req.body
    if (!event_name || !event_date) return res.status(400).json({ error: 'event_name and event_date required' })

    const { data: existing } = await supabase.from('cap_timeline').select('display_order').order('display_order', { ascending: false }).limit(1)
    const nextOrder = display_order ?? ((existing?.[0]?.display_order ?? 0) + 1)

    const { data, error } = await supabase
      .from('cap_timeline')
      .insert({
        event_name, event_date, description, notes, alert_message,
        important_message, changes, link, display_order: nextOrder, is_done: false
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/admin/timeline/:id
router.put('/timeline/:id', async (req, res) => {
  try {
    const { event_name, event_date, description, is_done, display_order,
      notes, alert_message, important_message, changes, link } = req.body
    const { data, error } = await supabase
      .from('cap_timeline')
      .update({ event_name, event_date, description, is_done, display_order,
        notes, alert_message, important_message, changes, link })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/timeline/:id
router.delete('/timeline/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('cap_timeline').delete().eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/notes/student/:studentId
router.get('/notes/student/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('student_id', req.params.studentId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/notes
router.post('/notes', async (req, res) => {
  try {
    const { student_id, text, is_private } = req.body
    const { data, error } = await supabase
      .from('notes')
      .insert({ student_id, text, is_private, created_by: req.user.member_id, created_by_role: req.user.role })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
