"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function RequirementsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/customer/requirements")
  }, [router])
  return <div className="flex items-center justify-center h-screen">Loading...</div>
}