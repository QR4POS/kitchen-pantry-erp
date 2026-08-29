"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function MyQuotationPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/customer/quotation")
  }, [router])
  return <div className="flex items-center justify-center h-screen">Loading...</div>
}