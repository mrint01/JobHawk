import type { Platform } from '../types'

interface Props { platform: Platform }

const META: Record<Platform, { label: string; classes: string; dot: string }> = {
  linkedin:  {
    label: 'LinkedIn',
    classes: 'bg-[#0077B5]/10 text-[#0077B5] border-[#0077B5]/25 dark:bg-[#0077B5]/15 dark:text-[#4DB8FF] dark:border-[#0077B5]/30',
    dot: 'bg-[#0077B5]',
  },
  stepstone: {
    label: 'StepStone',
    classes: 'bg-[#F58220]/10 text-[#C46010] border-[#F58220]/25 dark:bg-[#F58220]/15 dark:text-[#F5A050] dark:border-[#F58220]/30',
    dot: 'bg-[#F58220]',
  },
  xing: {
    label: 'Xing',
    classes: 'bg-[#00B67A]/10 text-[#008A5C] border-[#00B67A]/25 dark:bg-[#00B67A]/15 dark:text-[#00D48A] dark:border-[#00B67A]/30',
    dot: 'bg-[#00B67A]',
  },
  indeed: {
    label: 'Indeed',
    classes: 'bg-[#2164f3]/10 text-[#1a4fc7] border-[#2164f3]/25 dark:bg-[#2164f3]/15 dark:text-[#5b8cff] dark:border-[#2164f3]/30',
    dot: 'bg-[#2164f3]',
  },
}

export default function PlatformBadge({ platform }: Props) {
  const { label, classes, dot } = META[platform]
  return (
    <span className={`badge border ${classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {label}
    </span>
  )
}
