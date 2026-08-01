"use client"

import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { MessageSquare, Send, Plus, ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/shared/search-input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface ChatParticipant {
  id: string
  full_name: string
  role: string
  avatar_url: string | null
}

interface ConversationItem {
  id: string
  updated_at: string | null
  conversation_type: string | null
  participants: ChatParticipant[]
  lastMessage: { content: string; created_at: string } | null
  unread: number
}

interface MessageItem {
  id: string
  conversation_id: string
  sender_id: string
  message: string | null
  message_type: string
  created_at: string
  is_read: boolean
  sender?: { full_name: string; avatar_url: string | null } | null
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

function isYesterday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return d.toDateString() === yesterday.toDateString()
}

function formatConversationTime(dateStr: string | null): string {
  if (!dateStr) return ""
  if (isToday(dateStr)) return formatMessageTime(dateStr)
  if (isYesterday(dateStr)) return "Yesterday"
  return formatDate(dateStr)
}

const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  contractor: "Contractor",
  staff: "Staff",
  admin: "Admin",
}

export default function MessagesPage() {
  const { addToast } = useToast()
  const supabase = createClient()

  const [currentUser, setCurrentUser] = useState<ChatParticipant | null>(null)
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [availableUsers, setAvailableUsers] = useState<ChatParticipant[]>([])
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [startingConv, setStartingConv] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  )

  const selectedParticipant = useMemo(() => {
    if (!selected) return null
    return selected.participants.find((p) => p.id !== currentUser?.id) ?? selected.participants[0] ?? null
  }, [selected, currentUser])

  const filteredConversations = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter((c) =>
      c.participants.filter((p) => p.id !== currentUser?.id)
        .map((p) => p.full_name)
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
  }, [conversations, search, currentUser])

  const loadConversations = useCallback(async (userId?: string) => {
    const uid = userId ?? currentUser?.id
    if (!uid) return
    const { data: convs, error } = await supabase
      .from("conversations")
      .select("id, updated_at, conversation_type, conversation_members(user_id, profiles(full_name, role, avatar_url))")
      .order("updated_at", { ascending: false, nullsFirst: false })

    if (error) return

    const rows = (convs ?? []) as unknown as {
      id: string
      updated_at: string | null
      conversation_type: string | null
      conversation_members?: {
        user_id: string
        profiles: { full_name: string; role: string; avatar_url: string | null } | null
      }[]
    }[]

    const ids = rows.map((r) => r.id)
    const msgMap = new Map<string, { content: string; created_at: string }>()
    const unreadMap = new Map<string, number>()
    if (ids.length > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, message, created_at, is_read")
        .in("conversation_id", ids)
        .order("created_at", { ascending: true })
      for (const m of (msgs ?? []) as { conversation_id: string; sender_id: string; message: string | null; created_at: string; is_read: boolean }[]) {
        msgMap.set(m.conversation_id, { content: m.message ?? "", created_at: m.created_at })
        if (m.sender_id !== uid && !m.is_read) {
          unreadMap.set(m.conversation_id, (unreadMap.get(m.conversation_id) ?? 0) + 1)
        }
      }
    }

    const items: ConversationItem[] = rows.map((r) => ({
      id: r.id,
      updated_at: r.updated_at,
      conversation_type: r.conversation_type,
      participants: (r.conversation_members ?? [])
        .map((m) => ({
          id: m.user_id,
          full_name: m.profiles?.full_name ?? "Unknown",
          role: m.profiles?.role ?? "customer",
          avatar_url: m.profiles?.avatar_url ?? null,
        }))
        .filter((p) => p.id !== uid),
      lastMessage: msgMap.get(r.id) ?? null,
      unread: unreadMap.get(r.id) ?? 0,
    }))

    setConversations(items)
  }, [supabase, currentUser])

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true)
    const { data } = await supabase
      .from("messages")
      .select("*, sender:profiles!sender_id(full_name, avatar_url)")
      .eq("conversation_id", convId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
    setMessages((data as unknown as MessageItem[]) ?? [])
    setLoadingMessages(false)
  }, [supabase])

  const markRead = useCallback(async (convId: string) => {
    if (!currentUser) return
    await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("conversation_id", convId)
      .neq("sender_id", currentUser.id)
      .eq("is_read", false)
    await supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", convId)
      .eq("user_id", currentUser.id)
  }, [supabase, currentUser])

  useEffect(() => {
    async function init() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()
      if (!authUser) return
      const me: ChatParticipant = {
        id: authUser.id,
        full_name: (authUser.user_metadata?.full_name as string) ?? authUser.email?.split("@")[0] ?? "Admin",
        role: "admin",
        avatar_url: null,
      }
      setCurrentUser(me)

      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, role, avatar_url")
        .in("role", ["customer", "contractor", "staff"])
        .eq("is_active", true)
        .order("full_name")
      setAvailableUsers((profilesData as unknown as ChatParticipant[]) ?? [])

      await loadConversations(me.id)
      setLoading(false)
    }
    init()
  }, [supabase, loadConversations])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  useEffect(() => {
    if (!selectedId || !currentUser) return
    loadMessages(selectedId)
    markRead(selectedId)
    const t = setInterval(() => {
      loadMessages(selectedId)
      loadConversations()
    }, 5000)
    return () => clearInterval(t)
  }, [selectedId, currentUser, loadMessages, loadConversations, markRead])

  async function handleSelectConversation(convId: string) {
    setSelectedId(convId)
    loadMessages(convId)
    markRead(convId)
    loadConversations()
  }

  async function handleSend() {
    const text = newMessage.trim()
    if (!text || !selected || !currentUser) return
    setNewMessage("")
    const { error } = await supabase.from("messages").insert({
      conversation_id: selected.id,
      sender_id: currentUser.id,
      message: text,
      message_type: "text",
    })
    if (error) {
      addToast({ title: "Error", description: "Failed to send message.", variant: "destructive" })
      return
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", selected.id)

    const otherIds = selected.participants.filter((p) => p.id !== currentUser.id).map((p) => p.id)
    if (otherIds.length > 0) {
      await supabase.from("notifications").insert(
        otherIds.map((uid) => ({
          user_id: uid,
          title: "New Message",
          message: `${currentUser.full_name}: ${text}`,
          type: "message",
          reference_type: "conversation",
          reference_id: selected.id,
        }))
      )
    }
    loadMessages(selected.id)
    loadConversations()
  }

  async function handleStartNewConversation() {
    if (!selectedUser || !currentUser || startingConv) return
    setStartingConv(true)
    try {
      // Reuse an existing conversation if one already exists with this user.
      const { data: adminMemberships } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", currentUser.id)
      const adminIds = (adminMemberships ?? []).map((m: { conversation_id: string }) => m.conversation_id)

      let convId: string | null = null
      if (adminIds.length > 0) {
        const { data: existing } = await supabase
          .from("conversation_members")
          .select("conversation_id")
          .in("conversation_id", adminIds)
          .eq("user_id", selectedUser)
          .limit(1)
          .maybeSingle()
        if (existing) convId = (existing as { conversation_id: string }).conversation_id
      }

      if (!convId) {
        const participant = availableUsers.find((u) => u.id === selectedUser)
        const conversation_type =
          participant?.role === "contractor" ? "contractor" : participant?.role === "staff" ? "internal" : "customer_support"
        const { data: conv, error } = await supabase
          .from("conversations")
          .insert({
            conversation_type,
            created_by: currentUser.id,
          })
          .select("id")
          .single()
        if (error) throw error
        await supabase.from("conversation_members").insert([
          { conversation_id: conv.id, user_id: currentUser.id },
          { conversation_id: conv.id, user_id: selectedUser },
        ])
        convId = conv.id
      }

      setNewDialogOpen(false)
      setSelectedUser(null)
      if (!convId) return
      await loadConversations()
      await handleSelectConversation(convId)
    } catch {
      addToast({ title: "Error", description: "Failed to start conversation.", variant: "destructive" })
    } finally {
      setStartingConv(false)
    }
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="text-muted-foreground">Conversations with customers, contractors, and staff</p>
        </div>
        <Button onClick={() => setNewDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          New Message
        </Button>
      </div>

      <motion.div variants={itemVariants}>
        <Card className="overflow-hidden">
          <div className="flex h-[calc(100vh-16rem)]">
            {/* Left Panel - Conversation List */}
            <div className="w-80 border-r shrink-0 flex flex-col">
              <div className="p-3 border-b">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search conversations..."
                />
              </div>
              <ScrollArea className="flex-1">
                {loading ? (
                  <div className="space-y-3 p-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="size-10 rounded-full" />
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-3.5 w-2/3" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredConversations.map((conv) => (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => handleSelectConversation(conv.id)}
                        className={cn(
                          "w-full text-left p-3 flex items-start gap-3 transition-colors hover:bg-accent/50",
                          selectedId === conv.id && "bg-accent"
                        )}
                      >
                        <Avatar className="size-10 shrink-0">
                          <AvatarImage src={selectedParticipant?.avatar_url ?? undefined} />
                          <AvatarFallback>{getInitials(conv.participants[0]?.full_name ?? "?")}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">
                              {conv.participants.map((p) => p.full_name).join(", ") || "Me"}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatConversationTime(conv.lastMessage?.created_at ?? conv.updated_at)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {conv.lastMessage?.content ?? "No messages yet"}
                          </p>
                        </div>
                        {conv.unread > 0 && (
                          <Badge className="size-5 p-0 flex items-center justify-center rounded-full text-[10px] shrink-0 mt-1">
                            {conv.unread}
                          </Badge>
                        )}
                      </button>
                    ))}
                    {filteredConversations.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        No conversations found
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Right Panel - Chat Area */}
            <div className="flex-1 flex flex-col">
              {!selected ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
                  <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                    <MessageSquare className="size-8" />
                  </div>
                  <p className="text-lg font-medium">Select a conversation</p>
                  <p className="text-sm">Choose a conversation from the left panel to start chatting</p>
                </div>
              ) : (
                <>
                  {/* Chat Header */}
                  <div className="flex items-center gap-3 p-4 border-b shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 -ml-1 lg:hidden"
                      onClick={() => setSelectedId(null)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Avatar className="size-9 shrink-0">
                      <AvatarImage src={selectedParticipant?.avatar_url ?? undefined} />
                      <AvatarFallback>{getInitials(selectedParticipant?.full_name ?? "?")}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {selectedParticipant?.full_name ?? "Conversation"}
                      </p>
                      {selectedParticipant?.role && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {ROLE_LABELS[selectedParticipant.role] ?? selectedParticipant.role}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <ScrollArea className="flex-1 p-4">
                    {loadingMessages && messages.length === 0 ? (
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className={cn("h-10 rounded-2xl", i % 2 === 0 ? "w-2/3" : "w-1/2 ml-auto")} />
                        ))}
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        No messages yet. Say hello!
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((msg) => {
                          const isSent = msg.sender_id === currentUser?.id
                          return (
                            <div
                              key={msg.id}
                              className={cn(
                                "flex flex-col max-w-[75%]",
                                isSent ? "ml-auto items-end" : "items-start"
                              )}
                            >
                              {!isSent && (
                                <span className="text-xs text-muted-foreground mb-1">
                                  {msg.sender?.full_name ?? "Participant"}
                                </span>
                              )}
                              <div
                                className={cn(
                                  "rounded-2xl px-4 py-2 text-sm break-words",
                                  isSent
                                    ? "bg-primary text-primary-foreground rounded-br-md"
                                    : "bg-muted rounded-bl-md"
                                )}
                              >
                                {msg.message}
                              </div>
                              <span className="text-[10px] text-muted-foreground mt-1">
                                {formatMessageTime(msg.created_at)}
                              </span>
                            </div>
                          )
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </ScrollArea>

                  {/* Input Bar */}
                  <div className="p-4 border-t shrink-0">
                    <form
                      onSubmit={(e) => { e.preventDefault(); handleSend() }}
                      className="flex items-center gap-3"
                    >
                      <Input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type your message..."
                        className="flex-1"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!newMessage.trim()}
                      >
                        <Send className="size-4" />
                      </Button>
                    </form>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* New Message Dialog */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Conversation</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-sm text-muted-foreground">Select a customer, contractor, or staff member</p>
            <div className="divide-y max-h-64 overflow-y-auto rounded-md border">
              {availableUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUser(user.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-accent/50",
                    selectedUser === user.id && "bg-accent"
                  )}
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarImage src={user.avatar_url ?? undefined} />
                    <AvatarFallback>{getInitials(user.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{user.full_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </p>
                  </div>
                </button>
              ))}
              {availableUsers.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">No users found</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleStartNewConversation} disabled={!selectedUser || startingConv}>
              {startingConv ? "Starting..." : "Start Conversation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
