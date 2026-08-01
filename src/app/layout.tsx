import type { Metadata } from "next"
import Script from "next/script"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Kitchen Pantry ERP",
  description: "Enterprise Resource Planning system for Kitchen Pantry - Manage customers, projects, contractors, and inventory",
  icons: {
    icon: "/favicon.ico",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} h-full antialiased`} style={{ colorScheme: "light" }}>
      <body className="min-h-full flex flex-col font-sans">
        <Script
          id="ethereum-redefinition-guard"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function () {
              if (typeof window === "undefined") return
              var original = Object.defineProperty
              Object.defineProperty = function (target, key, descriptor) {
                if (key === "ethereum" && (target === window || target === globalThis || target === self)) {
                  var current = Object.getOwnPropertyDescriptor(target, key)
                  if (current && !current.configurable) return target
                }
                return original.call(this, target, key, descriptor)
              }
            })()`,
          }}
        />
        {children}
      </body>
    </html>
  )
}
