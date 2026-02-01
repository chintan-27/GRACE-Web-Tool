import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/90",
        destructive:
          "bg-error text-error-foreground hover:bg-error/90 focus-visible:ring-error/50",
        outline:
          "border border-border bg-background hover:bg-surface hover:text-foreground",
        secondary:
          "bg-surface text-foreground hover:bg-surface-elevated",
        ghost:
          "hover:bg-surface hover:text-foreground",
        link: "text-accent underline-offset-4 hover:underline",
        // Medical/accent variants
        accent:
          "bg-accent text-accent-foreground hover:bg-accent-hover shadow-sm shadow-accent/25",
        "accent-outline":
          "border-2 border-accent text-accent hover:bg-accent/10 hover:text-accent",
        "accent-ghost":
          "text-accent hover:bg-accent/10 hover:text-accent",
        // Success variant for completion states
        success:
          "bg-success text-success-foreground hover:bg-success/90 shadow-sm shadow-success/25",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md gap-1.5 px-3 text-xs",
        lg: "h-12 rounded-xl px-8 text-base",
        xl: "h-14 rounded-xl px-10 text-lg",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
