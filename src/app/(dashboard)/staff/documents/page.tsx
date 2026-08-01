"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { FileText, FileImage, FileSpreadsheet, Upload, FolderKanban, User, Calendar } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { formatDate } from "@/lib/auth/helpers"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { cn } from "@/utils/cn"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface Document {
  id: string
  file_name: string
  file_type: string
  project_name: string
  uploaded_by: string
  created_at: string
  file_size?: string
}

const mockDocuments: Document[] = [
  { id: "1", file_name: "Sharma_Kitchen_Design_v2.pdf", file_type: "pdf", project_name: "Sharma Modular Kitchen", uploaded_by: "You", created_at: "2025-07-28T10:30:00Z", file_size: "2.4 MB" },
  { id: "2", file_name: "Gupta_Room_Measurements.xlsx", file_type: "xlsx", project_name: "Gupta Kitchen Renovation", uploaded_by: "You", created_at: "2025-07-27T14:15:00Z", file_size: "1.1 MB" },
  { id: "3", file_name: "Patel_3D_Render.png", file_type: "png", project_name: "Patel Kitchen Design", uploaded_by: "Admin", created_at: "2025-07-26T09:00:00Z", file_size: "5.8 MB" },
  { id: "4", file_name: "Desai_Quotation_Final.pdf", file_type: "pdf", project_name: "Desai Premium Kitchen", uploaded_by: "Admin", created_at: "2025-07-25T16:45:00Z", file_size: "0.9 MB" },
  { id: "5", file_name: "Singh_Site_Photos.zip", file_type: "zip", project_name: "Singh Compact Kitchen", uploaded_by: "You", created_at: "2025-07-24T11:20:00Z", file_size: "12.3 MB" },
  { id: "6", file_name: "Modular_Components_Catalog.pdf", file_type: "pdf", project_name: "General", uploaded_by: "Admin", created_at: "2025-07-23T08:00:00Z", file_size: "8.5 MB" },
  { id: "7", file_name: "Installation_Checklist.xlsx", file_type: "xlsx", project_name: "Gupta Kitchen Renovation", uploaded_by: "Admin", created_at: "2025-07-22T13:30:00Z", file_size: "0.5 MB" },
  { id: "8", file_name: "Kitchen_Elevation_Drawing.pdf", file_type: "pdf", project_name: "Sharma Modular Kitchen", uploaded_by: "You", created_at: "2025-07-21T15:10:00Z", file_size: "3.2 MB" },
  { id: "9", file_name: "Material_Swatch_Images.png", file_type: "png", project_name: "General", uploaded_by: "Admin", created_at: "2025-07-20T10:00:00Z", file_size: "4.1 MB" },
  { id: "10", file_name: "Client_Approval_Form.pdf", file_type: "pdf", project_name: "Patel Kitchen Design", uploaded_by: "You", created_at: "2025-07-19T09:30:00Z", file_size: "1.8 MB" },
]

function getFileIcon(fileType: string) {
  switch (fileType) {
    case "pdf":
      return <FileText className="size-8 text-red-500" />
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return <FileImage className="size-8 text-blue-500" />
    case "xlsx":
    case "xls":
    case "csv":
      return <FileSpreadsheet className="size-8 text-emerald-500" />
    default:
      return <FileText className="size-8 text-muted-foreground" />
  }
}

export default function StaffDocumentsPage() {
  const [documents] = useState<Document[]>(mockDocuments)
  const [loading, setLoading] = useState(false)
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  const uploadedByMe = documents.filter((d) => d.uploaded_by === "You")

  const groupedByProject = documents.reduce<Record<string, Document[]>>((acc, doc) => {
    const key = doc.project_name
    if (!acc[key]) acc[key] = []
    acc[key].push(doc)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Document Management</h1>
          <p className="text-muted-foreground">Store and manage project documents</p>
        </div>
        <Button>
          <Upload className="size-4 mr-2" />
          Upload Document
        </Button>
      </div>

      <motion.div variants={itemVariants}>
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="by-project">By Project</TabsTrigger>
            <TabsTrigger value="uploaded-by-me">Uploaded by Me</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <DocumentGrid documents={documents} />
          </TabsContent>

          <TabsContent value="by-project" className="mt-4 space-y-6">
            {Object.entries(groupedByProject).map(([project, docs]) => (
              <div key={project}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <FolderKanban className="size-4" />
                  {project}
                  <Badge variant="secondary" className="ml-1">{docs.length}</Badge>
                </h3>
                <DocumentGrid documents={docs} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="uploaded-by-me" className="mt-4">
            {uploadedByMe.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No documents uploaded by you</div>
            ) : (
              <DocumentGrid documents={uploadedByMe} />
            )}
          </TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  )
}

function DocumentGrid({ documents }: { documents: Document[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {documents.map((doc) => (
        <motion.div
          key={doc.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="group cursor-pointer hover:border-primary/50 transition-colors h-full">
            <CardContent className="p-4 flex flex-col items-center text-center gap-3">
              <div className="size-14 rounded-lg bg-muted flex items-center justify-center group-hover:bg-accent transition-colors">
                {getFileIcon(doc.file_type)}
              </div>
              <div className="min-w-0 w-full">
                <p className="text-sm font-medium truncate" title={doc.file_name}>{doc.file_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{doc.project_name}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground w-full justify-center">
                <span className="flex items-center gap-1">
                  <User className="size-3" />
                  {doc.uploaded_by}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  {formatDate(doc.created_at)}
                </span>
              </div>
              {doc.file_size && (
                <Badge variant="outline" className="text-xs">{doc.file_size}</Badge>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}
