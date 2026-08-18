import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * shadcn's Button, with our variants.
 *
 * The sizes are the ones the app already shipped in styles/controls.ts:
 * default is `primaryButtonStyle` (14px 18px, 15px type), sm is
 * `compactButtonStyle`. `icon` is 44px because a tap target should be.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border-primary hover:bg-[#14532d]',
        secondary: 'bg-secondary text-secondary-foreground border-[#86efac] hover:bg-accent',
        outline: 'bg-white text-secondary-foreground border-input hover:bg-secondary',
        ghost: 'bg-transparent text-secondary-foreground border-transparent hover:bg-secondary',
        destructive: 'bg-[#fef2f2] text-destructive border-[#fecaca] hover:bg-[#fee2e2]',
      },
      size: {
        default: 'px-[18px] py-[14px] text-[15px]',
        sm: 'rounded-sm px-3 py-2.5 text-[13px]',
        icon: 'size-11 rounded-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
