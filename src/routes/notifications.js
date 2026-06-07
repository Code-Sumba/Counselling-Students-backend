import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole } from '../middleware/auth.js'

const router = express.Router()
router.use(authMiddleware)

// GET /api/notifications/timeline — CAP timeline visible to all roles
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

// GET /api/notifications/announcements — active announcements for students/all
router.get('/announcements', async (req, res) => {
  try {
    let query = supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20)

    if (req.user.role === 'student') {
      query = query.or('target_role.is.null,target_role.eq.student')
    }

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/notifications/mine
router.get('/mine', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/notifications/:id/read
router.put('/:id/read', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/notifications/read-all
router.put('/read-all', async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)

    if (error) return res.status(400).json({ error: error.message })
    res.json({ message: 'All marked as read' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/notifications/broadcast
router.post('/broadcast', requireRole('admin'), async (req, res) => {
  try {
    const { title, message, type, target, counselor_id, category, stage } = req.body

    let userQuery = supabase.from('users').select('id, member_id, role')

    if (target === 'students') userQuery = userQuery.eq('role', 'student')
    else if (target === 'counselors') userQuery = userQuery.eq('role', 'counselor')
    else if (target !== 'all') userQuery = userQuery.eq('role', target)

    const { data: users } = await userQuery.eq('is_active', true)
    if (!users?.length) return res.status(400).json({ error: 'No users match target' })

    // Filter by counselor/category/stage if needed
    let targetUsers = users
    if (counselor_id || category || stage !== undefined) {
      const { data: students } = await supabase
        .from('students')
        .select('user_id')
        .match({
          ...(counselor_id ? { counselor_id } : {}),
          ...(category ? { category } : {}),
          ...(stage !== undefined ? { stage } : {})
        })
      const studentUserIds = new Set(students?.map(s => s.user_id))
      targetUsers = users.filter(u => u.role !== 'student' || studentUserIds.has(u.id))
    }

    const notifications = targetUsers.map(u => ({
      user_id: u.id,
      member_id: u.member_id,
      type: type || 'broadcast',
      title,
      message,
      link: null
    }))

    const { error } = await supabase.from('notifications').insert(notifications)
    if (error) return res.status(400).json({ error: error.message })

    res.json({ sent: notifications.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
