import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-[#86efac] bg-accent text-accent-foreground',
        outline: 'border-input bg-secondary text-secondary-foreground',
        destructive: 'border-[#fecaca] bg-[#fef2f2] text-destructive',
        muted: 'border-transparent bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }
