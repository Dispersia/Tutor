import { getStats, levelForXp, xpForLevel } from '../db/repo'
import type { App } from '../context'

export function registerStats(app: App) {
  app.get('/api/stats', (c) => {
    const user = c.get('user')!
    const s = getStats(c.get('deps').db, user.id)
    const level = levelForXp(s.xpTotal)
    return c.json({
      xp: s.xpTotal,
      level,
      levelXp: xpForLevel(level),
      streak: s.streakDays,
      dailyGoal: s.dailyGoal,
    })
  })
}
