import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Kitchen Pantry ERP",
  description: "Kitchen Pantry Business ERP System",
}

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-[#050505] p-4">
      {/* Animated green glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-[#22c55e] opacity-5 blur-[120px] animate-pulse" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 rounded-full bg-[#16a34a] opacity-5 blur-[100px] animate-pulse delay-1000" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#22c55e] opacity-[0.03] blur-[150px]" />

      <div className="w-full max-w-md mx-auto mb-8 text-center relative z-10">
        <Link href="/" className="inline-flex items-center gap-3">
          <div className="size-11 rounded-xl bg-[#22c55e] flex items-center justify-center shadow-lg shadow-[#22c55e]/20">
            <span className="text-[#050505] text-xl font-bold">KP</span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-lg font-bold tracking-tight text-[#d1fae5]">Kitchen Pantry</span>
            <span className="text-xs text-[#6b7280] -mt-0.5">ERP System</span>
          </div>
        </Link>
      </div>
      {children}
    </div>
  )
}
