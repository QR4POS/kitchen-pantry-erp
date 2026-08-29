"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function ChatPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/contractor/messages")
  }, [router])
  return <div className="flex items-center justify-center h-screen">Loading...</div>
}