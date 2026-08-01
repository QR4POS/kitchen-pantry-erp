"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import { cn } from "@/utils/cn"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  render?: (item: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  searchable?: boolean
  searchKeys?: string[]
  pagination?: boolean
  pageSize?: number
  loading?: boolean
  onRowClick?: (item: T) => void
  emptyMessage?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  searchable = false,
  searchKeys,
  pagination = false,
  pageSize = 10,
  loading = false,
  onRowClick,
  emptyMessage = "No data found",
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState("")
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const [currentPage, setCurrentPage] = useState(1)

  const filteredData = useMemo(() => {
    if (!searchQuery || !searchKeys || searchKeys.length === 0) return data
    const query = searchQuery.toLowerCase()
    return data.filter((item) =>
      searchKeys.some((key) => {
        const val = item[key]
        return val != null && String(val).toLowerCase().includes(query)
      })
    )
  }, [data, searchQuery, searchKeys])

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null || bVal == null) return 0
      let cmp = 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal
      } else {
        cmp = String(aVal).localeCompare(String(bVal))
      }
      return sortDirection === "asc" ? cmp : -cmp
    })
  }, [filteredData, sortKey, sortDirection])

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize))
  const paginatedData = pagination
    ? sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sortedData

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDirection("asc")
    }
  }

  const renderSortIcon = (key: string) => {
    if (sortKey !== key) return <ArrowUpDown className="size-3 ml-1 opacity-40" />
    return sortDirection === "asc" ? (
      <ArrowUp className="size-3 ml-1" />
    ) : (
      <ArrowDown className="size-3 ml-1" />
    )
  }

  const renderSkeleton = () => (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {columns.map((col) => (
            <TableCell key={col.key}>
              <Skeleton className="h-4 w-24" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )

  const renderEmpty = () => (
    <TableRow>
      <TableCell colSpan={columns.length} className="text-center py-12">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Search className="size-8 opacity-40" />
          <p>{emptyMessage}</p>
        </div>
      </TableCell>
    </TableRow>
  )

  return (
    <div className="space-y-4">
      {searchable && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9">
            <SlidersHorizontal className="size-4 mr-2" />
            Filters
          </Button>
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={cn(
                      col.sortable && "cursor-pointer select-none",
                      col.className
                    )}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <span className="flex items-center">
                      {col.label}
                      {col.sortable && renderSortIcon(col.key)}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? renderSkeleton()
                : paginatedData.length === 0
                  ? renderEmpty()
                  : paginatedData.map((item, index) => (
                      <motion.tr
                        key={(item.id as string) || index}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className={cn(
                          "border-b transition-colors",
                          onRowClick && "cursor-pointer hover:bg-muted/50"
                        )}
                        onClick={() => onRowClick?.(item)}
                      >
                        {columns.map((col) => (
                          <TableCell key={col.key} className={col.className}>
                            {col.render
                              ? col.render(item)
                              : (item[col.key] as React.ReactNode) ?? "-"}
                          </TableCell>
                        ))}
                      </motion.tr>
                    ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, sortedData.length)} of{" "}
            {sortedData.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, currentPage - 2)
              const page = start + i
              if (page > totalPages) return null
              return (
                <Button
                  key={page}
                  variant={page === currentPage ? "default" : "outline"}
                  size="icon"
                  className="size-8"
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </Button>
              )
            })}
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
