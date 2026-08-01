"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/utils/cn"
import { Input } from "@/components/ui/input"

interface SearchInputProps {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  debounceMs?: number
}

export function SearchInput({
  value: externalValue,
  onChange,
  placeholder = "Search...",
  className,
  debounceMs = 300,
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState(externalValue ?? "")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isControlled = externalValue !== undefined

  const value = isControlled ? externalValue : internalValue

  const debouncedOnChange = useCallback(
    (val: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        onChange(val)
      }, debounceMs)
    },
    [onChange, debounceMs]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (!isControlled) {
      setInternalValue(newValue)
    }
    debouncedOnChange(newValue)
  }

  const handleClear = () => {
    if (!isControlled) {
      setInternalValue("")
    }
    onChange("")
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="pl-9 pr-9 h-9"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
