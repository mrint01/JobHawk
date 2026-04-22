import { useEffect, useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApp } from '../context/AppContext'
import { fetchAnalyticsSeriesApi, fetchUsersApi, type AuthUser } from '../services/api'

type Period = 'today' | 'last_day' | 'last_week' | 'last_month'

const PERIOD_LABELS: Record<Period, string> = {
  today: 'TODAY',
  last_day: 'YESTERDAY',
  last_week: 'LAST 7 DAYS',
  last_month: 'LAST 30 DAYS',
}

function periodStart(period: Period): string {
  const now = new Date()
  const d = new Date(now)
  if (period === 'today') d.setHours(0, 0, 0, 0)
  else if (period === 'last_day') d.setDate(d.getDate() - 1)
  else if (period === 'last_week') d.setDate(d.getDate() - 7)
  else d.setDate(d.getDate() - 30)
  return d.toISOString()
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 dark:text-slate-400 mt-1 uppercase tracking-wide">{label}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const { appState } = useApp()
  const isAdmin = appState.role === 'admin'

  const [period, setPeriod] = useState<Period>('last_month')
  const [users, setUsers] = useState<AuthUser[]>([])
  // null = all users (admin aggregate), string = specific userId
  const [selectedViewUserId, setSelectedViewUserId] = useState<string | null>(null)
  const [series, setSeries] = useState<Array<{ date: string; appliedCount: number }>>([])
  const [allTimeSeries, setAllTimeSeries] = useState<Array<{ date: string; appliedCount: number }>>([])
  const from = useMemo(() => periodStart(period), [period])

  // targetUserId for API calls
  const targetUserId = isAdmin ? (selectedViewUserId ?? 'all') : undefined

  useEffect(() => {
    if (isAdmin) fetchUsersApi().then(setUsers)
  }, [isAdmin])

  useEffect(() => {
    if (!appState.userId) return
    fetchAnalyticsSeriesApi(appState.userId, from, targetUserId).then(setSeries)
    fetchAnalyticsSeriesApi(appState.userId, '1970-01-01T00:00:00.000Z', targetUserId).then(setAllTimeSeries)
  }, [appState.userId, isAdmin, from, targetUserId])

  const chartTotal = series.reduce((sum, item) => sum + item.appliedCount, 0)

  const byDate = useMemo(() => new Map(allTimeSeries.map((item) => [item.date, item.appliedCount])), [allTimeSeries])

  function dayKey(offset: number): string {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    return d.toISOString().slice(0, 10)
  }

  function sumLastDays(days: number): number {
    let total = 0
    for (let i = 0; i < days; i++) total += byDate.get(dayKey(i)) ?? 0
    return total
  }

  const todayCount = byDate.get(dayKey(0)) ?? 0
  const yesterdayCount = byDate.get(dayKey(1)) ?? 0
  const last7Count = sumLastDays(7)
  const last30Count = sumLastDays(30)
  const allTimeCount = allTimeSeries.reduce((sum, item) => sum + item.appliedCount, 0)

  const chartData = useMemo(() => {
    const fromDate = new Date(from)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date()
    toDate.setHours(0, 0, 0, 0)
    const dataMap = new Map(series.map((item) => [item.date, item.appliedCount]))
    const dates: { date: string; count: number; label: string }[] = []
    const cursor = new Date(fromDate)
    while (cursor <= toDate) {
      const key = cursor.toISOString().slice(0, 10)
      dates.push({
        date: key,
        count: dataMap.get(key) ?? 0,
        label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    return dates
  }, [series, from])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="card p-5 sm:p-6 space-y-5">

        {/* Header row */}
        <div className="flex flex-wrap gap-3 items-start justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Your applications</h1>
          <span className="px-3 py-1 text-xs font-semibold tracking-widest rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            {PERIOD_LABELS[period]}
          </span>
        </div>

        {/* Period selector + optional admin user filter */}
        <div className="flex flex-wrap gap-4 items-center">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-slate-400 whitespace-nowrap">Users</span>
              <select
                className="input max-w-[200px]"
                value={selectedViewUserId ?? ''}
                onChange={(e) => setSelectedViewUserId(e.target.value === '' ? null : e.target.value)}
              >
                <option value="">All users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-slate-400 whitespace-nowrap">Chart period</span>
            <select className="input max-w-[190px]" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="today">Today</option>
              <option value="last_day">Yesterday</option>
              <option value="last_week">Last 7 days</option>
              <option value="last_month">Last 30 days</option>
            </select>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatTile label="Today" value={todayCount} />
          <StatTile label="Yesterday" value={yesterdayCount} />
          <StatTile label="Last 7 days" value={last7Count} />
          <StatTile label="Last 30 days" value={last30Count} />
          <StatTile label="All time" value={allTimeCount} />
        </div>

        {/* Chart range text */}
        <p className="text-sm text-gray-600 dark:text-slate-300">
          Applications in chart range: <span className="font-semibold text-gray-900 dark:text-white">{chartTotal}</span>
        </p>

        {/* Chart */}
        <div className="h-64 rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 pt-4 pr-4">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-slate-400">No data in selected period.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  interval={Math.max(0, Math.floor((chartData.length - 1) / 9))}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                  itemStyle={{ color: '#a5b4fc' }}
                  formatter={(v) => [v, 'Applications']}
                  labelFormatter={(label) => label}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#areaGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-400 dark:text-slate-500">
          {isAdmin
            ? selectedViewUserId
              ? `Showing data for: ${users.find((u) => u.id === selectedViewUserId)?.username ?? selectedViewUserId}`
              : 'Showing aggregated data across all users.'
            : 'Only your apply activity is shown.'}
        </p>
      </div>

    </div>
  )
}
