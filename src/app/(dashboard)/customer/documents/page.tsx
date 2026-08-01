"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import {
  FileText,
  Image,
  Download,
  FolderKanban,
  Search,
  File as FileIcon,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/shared/search-input"
import { cn } from "@/utils/cn"
import { formatDate } from "@/lib/auth/helpers"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface Document {
  id: string
  name: string
  type: "pdf" | "image" | "drawing"
  category: string
  projectName: string
  date: string
  url: string
}

const mockDocuments: Document[] = [
  { id: "d1", name: "Kitchen Quotation - Modern L-Shape", type: "pdf", category: "Quotation PDF", projectName: "Modern L-Shape Kitchen", date: "2025-07-15T10:00:00Z", url: "#" },
  { id: "d2", name: "Warranty Certificate - Modern L-Shape", type: "pdf", category: "Warranty Certificate", projectName: "Modern L-Shape Kitchen", date: "2025-07-20T10:00:00Z", url: "#" },
  { id: "d3", name: "Installation Guide - Cabinet Assembly", type: "pdf", category: "Installation Documents", projectName: "Modern L-Shape Kitchen", date: "2025-07-22T10:00:00Z", url: "#" },
  { id: "d4", name: "Final Invoice - Modern L-Shape", type: "pdf", category: "Final Invoice", projectName: "Modern L-Shape Kitchen", date: "2025-07-25T10:00:00Z", url: "#" },
  { id: "d5", name: "Progress Photo - Cabinetry Installed", type: "image", category: "Progress Photos", projectName: "Modern L-Shape Kitchen", date: "2025-07-28T14:00:00Z", url: "#" },
  { id: "d6", name: "Quotation - Classic U-Shape", type: "pdf", category: "Quotation PDF", projectName: "Classic U-Shape Kitchen", date: "2025-06-10T10:00:00Z", url: "#" },
  { id: "d7", name: "Warranty Certificate - Classic U-Shape", type: "pdf", category: "Warranty Certificate", projectName: "Classic U-Shape Kitchen", date: "2025-06-18T10:00:00Z", url: "#" },
  { id: "d8", name: "Installation Checklist", type: "pdf", category: "Installation Documents", projectName: "Classic U-Shape Kitchen", date: "2025-06-20T10:00:00Z", url: "#" },
  { id: "d9", name: "Final Invoice - Classic U-Shape", type: "pdf", category: "Final Invoice", projectName: "Classic U-Shape Kitchen", date: "2025-06-25T10:00:00Z", url: "#" },
  { id: "d10", name: "Progress Photo - Countertop Fitted", type: "image", category: "Progress Photos", projectName: "Classic U-Shape Kitchen", date: "2025-06-28T14:00:00Z", url: "#" },
]

function getCategoryIcon(category: string) {
  switch (category) {
    case "Quotation PDF": return FileText
    case "Warranty Certificate": return FileIcon
    case "Installation Documents": return FileText
    case "Final Invoice": return FileText
    case "Progress Photos": return Image
    default: return FileIcon
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case "pdf": return FileText
    case "image": return Image
    case "drawing": return FileIcon
    default: return FileIcon
  }
}

export default function CustomerDocumentsPage() {
  const [search, setSearch] = useState("")

  const grouped = useMemo(() => {
    const filtered = search
      ? mockDocuments.filter((d) =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.projectName.toLowerCase().includes(search.toLowerCase()) ||
          d.category.toLowerCase().includes(search.toLowerCase())
        )
      : mockDocuments

    const groups: Record<string, Document[]> = {}
    for (const doc of filtered) {
      if (!groups[doc.projectName]) groups[doc.projectName] = []
      groups[doc.projectName].push(doc)
    }
    return groups
  }, [search])

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Documents</h1>
          <p className="text-muted-foreground">Access quotations, invoices, warranties, and more</p>
        </div>
        <div className="w-64">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search documents..."
          />
        </div>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className="py-16 text-center">
              <FolderKanban className="size-16 mx-auto text-muted-foreground/30 mb-4" />
              <h2 className="text-xl font-semibold mb-2">No Documents Found</h2>
              <p className="text-muted-foreground">
                {search ? "Try a different search term." : "Documents will appear here once they are uploaded."}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        Object.entries(grouped).map(([projectName, docs]) => (
          <motion.div key={projectName} variants={itemVariants}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FolderKanban className="size-4" />
                  {projectName}
                </CardTitle>
                <CardDescription>{docs.length} document{docs.length !== 1 ? "s" : ""}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {docs.map((doc) => {
                    const CatIcon = getCategoryIcon(doc.category)
                    const TypeIcon = getTypeIcon(doc.type)
                    return (
                      <div
                        key={doc.id}
                        className="flex items-start gap-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <CatIcon className="size-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px] h-5 gap-1">
                              <TypeIcon className="size-3" />
                              {doc.type.toUpperCase()}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{doc.category}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(doc.date)}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon" className="size-8 shrink-0 mt-1" asChild>
                          <a href={doc.url} download>
                            <Download className="size-4" />
                          </a>
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))
      )}
    </motion.div>
  )
}
