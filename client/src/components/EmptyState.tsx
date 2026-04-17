import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
}

export default function EmptyState({ icon: Icon, title, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-gray-300 dark:text-slate-600" />
      </div>
      <h3 className="text-gray-700 dark:text-slate-300 font-semibold text-base mb-1">{title}</h3>
      <p className="text-gray-400 dark:text-slate-500 text-sm max-w-xs">{description}</p>
    </div>
  )
}
