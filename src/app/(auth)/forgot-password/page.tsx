'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { resetPasswordAction } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsPending(true)
    setError(null)

    const formData = new FormData()
    formData.append('email', email)

    try {
      const result = await resetPasswordAction(formData)
      if (result.success) {
        setSent(true)
      } else {
        setError(result.error || 'Failed to send reset email')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsPending(false)
    }
  }

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md mx-auto"
      >
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <CheckCircle2 className="size-6 text-emerald-600" />
            </div>
            <CardTitle className="text-xl">Check your email</CardTitle>
            <CardDescription>
              If an account exists with {email}, we&apos;ve sent a password reset link.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Link href="/login" className="text-sm text-primary hover:underline">
              Back to login
            </Link>
          </CardFooter>
        </Card>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto"
    >
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Reset your password</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm rounded-md px-3 py-2 border border-destructive/20">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isPending}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isPending || !email}>
              <Mail className="size-4 mr-2" />
              {isPending ? 'Sending...' : 'Send Reset Link'}
            </Button>
            <Link
              href="/login"
              className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Back to login
            </Link>
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  )
}
