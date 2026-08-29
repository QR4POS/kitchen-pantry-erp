"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function ContractorMyProjectsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/contractor/projects")
  }, [router])
  return <div className="flex items-center justify-center h-screen">Loading...</div>
}