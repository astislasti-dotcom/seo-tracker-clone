'use client'

export default function StatsCards({ keywords }) {
  const p1Count = keywords.filter(kw => kw.priority === 'P1').length
  const p2Count = keywords.filter(kw => kw.priority === 'P2').length
  const p3Count = keywords.filter(kw => kw.priority === 'P3').length

  const transaccionalCount = keywords.filter(kw => kw.intent === 'Transaccional').length
  const comercialCount = keywords.filter(kw => kw.intent === 'Comercial-mixta').length
  const informacionalCount = keywords.filter(kw => kw.intent === 'Informacional').length

  const stats = [
    {
      label: 'P1 (Críticos)',
      value: p1Count,
      color: 'from-red-600 to-red-700',
      icon: '🔴'
    },
    {
      label: 'P2 (Altos)',
      value: p2Count,
      color: 'from-orange-600 to-orange-700',
      icon: '🟠'
    },
    {
      label: 'P3 (Medios)',
      value: p3Count,
      color: 'from-yellow-600 to-yellow-700',
      icon: '🟡'
    },
    {
      label: 'Transaccionales',
      value: transaccionalCount,
      color: 'from-blue-600 to-blue-700',
      icon: '💳'
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, idx) => (
        <div
          key={idx}
          className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
        >
          <div className={`bg-gradient-to-br ${stat.color} h-1`}></div>
          <div className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">{stat.label}</h3>
              <span className="text-2xl">{stat.icon}</span>
            </div>
            <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
