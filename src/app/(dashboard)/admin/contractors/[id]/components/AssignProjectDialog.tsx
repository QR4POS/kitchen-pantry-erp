"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Search, Check, Loader2 } from "lucide-react"
import type { Project } from "@/types"

interface AssignProjectDialogProps {
  contractorId: string
}

export function AssignProjectDialog({ contractorId }: AssignProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [assigning, setAssigning] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function fetchProjects() {
      try {
        const { data } = await supabase
          .from("projects")
          .select("*")
          .is("contractor_id", null)
          .order("created_at", { ascending: false })
        setProjects((data as unknown as Project[]) ?? [])
      } catch {
        setProjects([])
      }
    }
    if (open) fetchProjects()
  }, [open, supabase])

  const filteredProjects = projects.filter((p) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      p.name?.toLowerCase().includes(query)
    )
  })

  async function handleAssign() {
    if (!selectedProjectId) return
    setAssigning(true)
    try {
      const { error } = await supabase
        .from("projects")
        .update({ contractor_id: contractorId })
        .eq("id", selectedProjectId)
        .select()
        .single()

      if (error) throw error
      setSelectedProjectId("")
      setSearchQuery("")
      setOpen(false)
    } catch {
      // handle error
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4 mr-1" />
          Assign Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Project</DialogTitle>
          <DialogDescription>
            Select a project to assign to this contractor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {filteredProjects.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">
                {searchQuery ? "No projects match your search" : "No unassigned projects found"}
              </p>
            ) : (
              filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors hover:bg-accent ${
                    selectedProjectId === project.id ? "border-primary bg-accent" : "border-border"
                  }`}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground">{project.status}</p>
                  </div>
                  {selectedProjectId === project.id && (
                    <div className="size-5 rounded-full bg-primary flex items-center justify-center shrink-0 ml-2">
                      <Check className="size-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={!selectedProjectId || assigning}>
            {assigning && <Loader2 className="size-4 mr-1 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}