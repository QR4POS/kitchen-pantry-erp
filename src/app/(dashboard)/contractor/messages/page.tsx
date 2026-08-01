"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { MessageSquare, Send, Plus, ChevronLeft } from "lucide-react"
import { formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/shared/search-input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Role } from "@/types"
import type { Message, User } from "@/types"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface Conversation {
  id: string
  participant: User
  messages: Message[]
  lastMessageAt: string
  unread: number
}

const ADMIN_USER: User = {
  id: "admin-1",
  email: "admin@kitchenpantry.com",
  full_name: "Admin",
  role: Role.ADMIN,
  avatar_url: "",
  created_at: "2025-01-01T10:00:00Z",
}

const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "conv1",
    participant: ADMIN_USER,
    messages: [
      { id: "m1", sender_id: "admin-1", receiver_id: "me", content: "Hi, the Sharma project materials have been dispatched. Please confirm receipt.", is_read: true, created_at: "2026-07-28T09:00:00Z" },
      { id: "m2", sender_id: "me", receiver_id: "admin-1", content: "Received. Everything looks good. Will start installation tomorrow.", is_read: true, created_at: "2026-07-28T09:15:00Z" },
      { id: "m3", sender_id: "admin-1", receiver_id: "me", content: "Great! Keep me posted on progress.", is_read: true, created_at: "2026-07-28T09:30:00Z" },
      { id: "m4", sender_id: "admin-1", receiver_id: "me", content: "Also, we need the site photos for the Patel project by end of week.", is_read: false, created_at: "2026-07-30T14:00:00Z" },
    ],
    lastMessageAt: "2026-07-30T14:00:00Z",
    unread: 1,
  },
  {
    id: "conv2",
    participant: ADMIN_USER,
    messages: [
      { id: "m5", sender_id: "me", receiver_id: "admin-1", content: "Completed the measurement for the Verma Villa project.", is_read: true, created_at: "2026-07-25T11:00:00Z" },
      { id: "m6", sender_id: "admin-1", receiver_id: "me", content: "Perfect. I'll share the estimate with the customer.", is_read: true, created_at: "2026-07-25T11:30:00Z" },
    ],
    lastMessageAt: "2026-07-25T11:30:00Z",
    unread: 0,
  },
  {
    id: "conv3",
    participant: ADMIN_USER,
    messages: [
      { id: "m7", sender_id: "admin-1", receiver_id: "me", content: "Payment for the Patel project has been processed.", is_read: true, created_at: "2026-07-20T16:00:00Z" },
      { id: "m8", sender_id: "me", receiver_id: "admin-1", content: "Thank you! Received the amount.", is_read: true, created_at: "2026-07-20T16:15:00Z" },
    ],
    lastMessageAt: "2026-07-20T16:15:00Z",
    unread: 0,
  },
]

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

function formatConversationTime(dateStr: string): string {
  if (isToday(dateStr)) return formatMessageTime(dateStr)
  if (isYesterday(dateStr)) return "Yesterday"
  return formatDate(dateStr)
}

export default function ContractorMessagesPage() {
  const [conversations] = useState<Conversation[]>(MOCK_CONVERSATIONS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  )

  const filteredConversations = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter((c) =>
      c.participant.full_name.toLowerCase().includes(q)
    )
  }, [conversations, search])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selected?.messages.length])

  function handleSend() {
    if (!newMessage.trim() || !selected) return
    setNewMessage("")
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="text-muted-foreground">
          Communicate with admin regarding your projects
        </p>
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
                <div className="divide-y">
                  {filteredConversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setSelectedId(conv.id)}
                      className={cn(
                        "w-full text-left p-3 flex items-start gap-3 transition-colors hover:bg-accent/50",
                        selectedId === conv.id && "bg-accent"
                      )}
                    >
                      <Avatar className="size-10 shrink-0">
                        <AvatarFallback>
                          {getInitials(conv.participant.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">
                            {conv.participant.full_name}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatConversationTime(conv.lastMessageAt)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {conv.messages[conv.messages.length - 1]?.content}
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
                  <p className="text-sm">
                    Choose a conversation from the left panel to start chatting
                  </p>
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
                      <AvatarFallback>
                        {getInitials(selected.participant.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {selected.participant.full_name}
                      </p>
                      <p className="text-xs text-emerald-500">Online</p>
                    </div>
                  </div>

                  {/* Messages */}
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-3">
                      {selected.messages.map((msg) => {
                        const isSent = msg.sender_id === "me"
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
                                {selected.participant.full_name}
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
                              {msg.content}
                            </div>
                            <span className="text-[10px] text-muted-foreground mt-1">
                              {formatMessageTime(msg.created_at)}
                            </span>
                          </div>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  {/* Input Bar */}
                  <div className="p-4 border-t shrink-0">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        handleSend()
                      }}
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
    </motion.div>
  )
}
