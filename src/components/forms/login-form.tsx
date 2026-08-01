"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { motion } from "framer-motion"
import { Eye, EyeOff, LogIn, Mail, Lock } from "lucide-react"
import { loginSchema, type LoginInput } from "@/lib/validations/schemas"
import { loginAction } from "@/lib/auth/actions"
import { cn } from "@/utils/cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InlineLoader } from "@/components/shared/loading"

interface LoginFormProps {
  currentUser?: { email: string; role: string } | null
}

export function LoginForm({ currentUser }: LoginFormProps) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginInput) => {
    setIsPending(true)
    setServerError(null)
    const formData = new FormData()
    formData.append("email", data.email)
    formData.append("password", data.password)

    try {
      const result = await loginAction(formData)
      if (!result.success) { setServerError(result.error || "Login failed"); return }
      if (result.requiresPasswordChange) { router.push("/change-password"); return }
      if (result.redirectTo) router.push(result.redirectTo)
    } catch {
      setServerError("An unexpected error occurred. Please try again.")
    } finally { setIsPending(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-md mx-auto relative z-10"
    >
      <div className="glass rounded-2xl p-8 glow-green">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#d1fae5]">Welcome back</h1>
          <p className="text-sm text-[#6b7280] mt-1">Sign in to your Kitchen Pantry account</p>
          {currentUser && (
            <div className="mt-4 p-3 rounded-lg bg-[#181818] border border-[#262626]">
              <p className="text-xs text-[#6b7280]">Currently signed in as</p>
              <p className="text-sm text-[#d1fae5] font-medium">{currentUser.email}</p>
              <p className="text-xs text-[#22c55e] capitalize">{currentUser.role}</p>
              <form action="/auth/signout" method="post" className="mt-2">
                <button type="submit" className="text-xs text-[#ef4444] hover:text-[#f87171] transition-colors underline">
                  Sign out and use different account
                </button>
              </form>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {serverError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="bg-[#ef4444]/10 text-[#ef4444] text-sm rounded-lg px-4 py-3 border border-[#ef4444]/20"
            >
              {serverError}
            </motion.div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-[#a7f3d0] text-sm font-medium">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#6b7280]" />
              <Input
                id="email" type="email" placeholder="name@example.com"
                {...register("email")}
                className={cn("pl-10 bg-[#0d0d0d] border-[#262626] text-[#d1fae5] placeholder:text-[#6b7280] focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]/30 rounded-lg h-11", errors.email && "border-[#ef4444]")}
                disabled={isPending}
              />
            </div>
            {errors.email && <p className="text-xs text-[#ef4444]">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-[#a7f3d0] text-sm font-medium">Password</Label>
              <Link href="/forgot-password" className="text-xs text-[#22c55e] hover:text-[#16a34a] transition-colors">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#6b7280]" />
              <Input
                id="password" type={showPassword ? "text" : "password"} placeholder="Enter your password"
                {...register("password")}
                className={cn("pl-10 pr-10 bg-[#0d0d0d] border-[#262626] text-[#d1fae5] placeholder:text-[#6b7280] focus:border-[#22c55e] focus:ring-1 focus:ring-[#22c55e]/30 rounded-lg h-11", errors.password && "border-[#ef4444]")}
                disabled={isPending}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-[#d1fae5] transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-[#ef4444]">{errors.password.message}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="remember" className="rounded border-[#262626] bg-[#0d0d0d] text-[#22c55e] focus:ring-[#22c55e]/30 accent-[#22c55e]" />
            <Label htmlFor="remember" className="text-sm text-[#9ca3af] cursor-pointer">Remember me</Label>
          </div>

          <Button type="submit" className="w-full h-11 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[#050505] font-semibold transition-all duration-300 shadow-lg shadow-[#22c55e]/20 hover:shadow-[#22c55e]/30" disabled={isPending}>
            {isPending ? (
              <span className="flex items-center gap-2">
                <InlineLoader /> Signing in...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <LogIn className="size-4" /> Sign In
              </span>
            )}
          </Button>
        </form>
      </div>
    </motion.div>
  )
}
