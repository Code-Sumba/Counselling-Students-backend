import { supabase } from '../lib/supabase.js'

export async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No token' })

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: dbUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!dbUser || !dbUser.is_active) return res.status(401).json({ error: 'Account inactive' })

  req.user = dbUser
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

// requirePermission — admin always passes; counselors are checked against their permissions column
export function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next()
    if (req.user.role === 'counselor') {
      const perms = req.user.permissions || {}
      // If column not yet set up, default to allow everything
      if (Object.keys(perms).length === 0) return next()
      if (perms[permission] === false) {
        return res.status(403).json({ error: `Permission denied: ${permission}` })
      }
    }
    next()
  }
}
