"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface FilterOption {
  value: string
  label: string
}

interface FilterDropdownProps {
  value: string
  onValueChange: (value: string) => void
  options: FilterOption[]
  placeholder?: string
  className?: string
}

export function FilterDropdown({ value, onValueChange, options, placeholder = "Filter...", className }: FilterDropdownProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
