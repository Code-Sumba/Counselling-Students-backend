import express from 'express'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, requirePermission } from '../middleware/auth.js'
import { uploadSingle } from '../middleware/upload.js'

const router = express.Router()
router.use(authMiddleware)

// GET /api/documents/student/:studentId
router.get('/student/:studentId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('student_id', req.params.studentId)
      .order('created_at')

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/documents/:id/status
router.put('/:id/status', requireRole('counselor', 'admin'), requirePermission('documents_manage'), async (req, res) => {
  try {
    const { status, remarks } = req.body
    const updates = { status, remarks, updated_at: new Date().toISOString() }
    if (status === 'Verified') {
      updates.verified_at = new Date().toISOString()
      updates.verified_by = req.user.member_id
    }

    const { data, error } = await supabase
      .from('documents')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Get student info to notify
    const { data: student } = await supabase
      .from('students')
      .select('user_id, member_id')
      .eq('id', data.student_id)
      .single()

    if (student) {
      await supabase.from('notifications').insert({
        user_id: student.user_id,
        member_id: student.member_id,
        type: 'document',
        title: `Document ${status}`,
        message: `Your document "${data.label}" has been marked as ${status}${remarks ? ': ' + remarks : ''}`,
        link: '/student/documents'
      })
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/documents/student/:studentId/upload
router.post('/student/:studentId/upload', (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, async (req, res) => {
  try {
    const { docId, docType } = req.body
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    // Upload to Supabase Storage
    const ext = req.file.originalname.split('.').pop()
    const filePath = `${req.params.studentId}/${docType}_${Date.now()}.${ext}`

    const { data: storageData, error: storageErr } = await supabase.storage
      .from('documents')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      })

    if (storageErr) return res.status(400).json({ error: storageErr.message })

    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(filePath)

    // Update document row
    const { data, error } = await supabase
      .from('documents')
      .update({
        status: 'Submitted',
        file_url: publicUrl,
        file_path: filePath,
        uploaded_at: new Date().toISOString()
      })
      .eq('id', docId)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Get student counselor to notify
    const { data: student } = await supabase
      .from('students')
      .select('counselor_id, member_id')
      .eq('id', req.params.studentId)
      .single()

    if (student?.counselor_id) {
      const { data: counselorUser } = await supabase
        .from('users').select('id, member_id').eq('id', student.counselor_id).single()
      if (counselorUser) {
        await supabase.from('notifications').insert({
          user_id: counselorUser.id,
          member_id: counselorUser.member_id,
          type: 'document',
          title: 'Document Uploaded',
          message: `Student ${student.member_id} uploaded "${data.label}"`,
          link: `/counselor/students`
        })
      }
    }

    await supabase.from('activity_log').insert({
      student_id: req.params.studentId,
      actor_id: req.user.member_id,
      actor_role: req.user.role,
      action: 'DOC_UPLOAD',
      details: { docType, fileName: req.file.originalname }
    })

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
