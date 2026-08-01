"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/utils/cn"
import { cva, type VariantProps } from "class-variance-authority"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground border",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
        success: "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type ToastVariant = NonNullable<VariantProps<typeof toastVariants>["variant"]>

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, "id">) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined)

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
      const newToast: Toast = { ...toast, id, duration: toast.duration ?? 5000 }
      setToasts((prev) => [...prev, newToast])
    },
    []
  )

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return context
}

function ToastViewport({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      data-slot="toast-viewport"
      className={cn(
        "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        className
      )}
    >
      {children}
    </div>
  )
}

interface ToastItemProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof toastVariants> {
  toast: Toast
  onClose: () => void
}

function ToastItem({
  className,
  variant,
  toast,
  onClose,
  ...props
}: ToastItemProps) {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, toast.duration ?? 5000)
    return () => clearTimeout(timer)
  }, [onClose, toast.duration])

  return (
    <div
      data-slot="toast"
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        {toast.title && (
          <div className="text-sm font-semibold">{toast.title}</div>
        )}
        {toast.description && (
          <div className="text-sm opacity-90">{toast.description}</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

function Toaster() {
  const { toasts, removeToast } = useToast()

  return (
    <ToastViewport>
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          variant={toast.variant}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </ToastViewport>
  )
}

export { ToastProvider, ToastViewport, ToastItem, useToast, Toaster }
export type { Toast, ToastVariant }
