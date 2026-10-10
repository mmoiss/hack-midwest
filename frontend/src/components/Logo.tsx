export const BRAND = '#7a9a6e'
export const HULL = 'M24 100 H180 Q174 126 158 140 H52 Q38 132 30 120 Z'
export const SKEG = 'M52 142 H80 L60 174 Z'

// The Skeg mark from branding/skeg-favicon.svg, inlined so it follows the text color.
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="22 41 160 160" aria-hidden="true">
      <circle cx="58" cy="78" r="11" fill="currentColor" />
      <circle cx="86" cy="78" r="11" fill={BRAND} />
      <circle cx="114" cy="78" r="11" fill="currentColor" />
      <circle cx="142" cy="78" r="11" fill="currentColor" />
      <path d={HULL} fill="currentColor" />
      <path d={SKEG} fill={BRAND} />
    </svg>
  )
}
