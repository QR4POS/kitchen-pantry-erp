'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Lock, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { changePasswordAction } from '@/lib/auth/actions'
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

export default function ChangePasswordPage() {
  const router = useRouter()
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsPending(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const newPass = formData.get('new_password') as string

    if (newPass.length < 6) {
      setError('New password must be at least 6 characters')
      setIsPending(false)
      return
    }

    try {
      const result = await changePasswordAction(formData)
      if (!result.success) {
        setError(result.error || 'Failed to change password')
        return
      }
      if (result.redirectTo) {
        router.push(result.redirectTo)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto"
    >
      <Card>
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <ShieldAlert className="size-6 text-amber-600" />
          </div>
          <CardTitle className="text-2xl font-bold">Change Your Password</CardTitle>
          <CardDescription>
            You must change your password before continuing. This is required for first-time login or
            after an admin reset.
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
              <Label htmlFor="current_password">Current Password</Label>
              <div className="relative">
                <Input
                  id="current_password"
                  name="current_password"
                  type={showCurrent ? 'text' : 'password'}
                  placeholder="Enter your current password"
                  required
                  disabled={isPending}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_password">New Password</Label>
              <div className="relative">
                <Input
                  id="new_password"
                  name="new_password"
                  type={showNew ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  disabled={isPending}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isPending}>
              <Lock className="size-4 mr-2" />
              {isPending ? 'Changing...' : 'Change Password'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  )
}
