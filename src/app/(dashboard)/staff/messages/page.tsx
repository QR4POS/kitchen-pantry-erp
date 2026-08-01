"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, Send, Phone, Mail, MoreVertical, ChevronLeft, User, MessageSquare } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface Message {
  id: string
  sender: string
  content: string
  timestamp: string
  is_mine: boolean
}

interface Conversation {
  id: string
  name: string
  role: string
  last_message: string
  last_message_time: string
  unread: number
  avatar_initials: string
  messages: Message[]
}

const mockConversations: Conversation[] = [
  {
    id: "1",
    name: "Rajesh Sharma",
    role: "Customer",
    last_message: "When will the installation start?",
    last_message_time: "2025-07-30T10:30:00Z",
    unread: 2,
    avatar_initials: "RS",
    messages: [
      { id: "m1", sender: "Rajesh Sharma", content: "Hi, I wanted to check on the kitchen design status.", timestamp: "2025-07-29T09:00:00Z", is_mine: false },
      { id: "m2", sender: "You", content: "Hello Rajesh! The design is almost complete. We'll share it by tomorrow.", timestamp: "2025-07-29T09:15:00Z", is_mine: true },
      { id: "m3", sender: "Rajesh Sharma", content: "That's great! Also, when will the installation start?", timestamp: "2025-07-30T10:30:00Z", is_mine: false },
      { id: "m4", sender: "Rajesh Sharma", content: "Please let me know the timeline.", timestamp: "2025-07-30T10:31:00Z", is_mine: false },
    ],
  },
  {
    id: "2",
    name: "Ananya Gupta",
    role: "Customer",
    last_message: "Thank you for the update!",
    last_message_time: "2025-07-28T14:20:00Z",
    unread: 0,
    avatar_initials: "AG",
    messages: [
      { id: "m5", sender: "You", content: "The materials have been ordered for your kitchen.", timestamp: "2025-07-28T14:00:00Z", is_mine: true },
      { id: "m6", sender: "Ananya Gupta", content: "Thank you for the update!", timestamp: "2025-07-28T14:20:00Z", is_mine: false },
    ],
  },
  {
    id: "3",
    name: "Vikram Patel",
    role: "Customer",
    last_message: "Can we change the cabinet color?",
    last_message_time: "2025-07-27T16:45:00Z",
    unread: 1,
    avatar_initials: "VP",
    messages: [
      { id: "m7", sender: "Vikram Patel", content: "Can we change the cabinet color to white?", timestamp: "2025-07-27T16:45:00Z", is_mine: false },
    ],
  },
  {
    id: "4",
    name: "Admin",
    role: "Admin",
    last_message: "Please submit the weekly report",
    last_message_time: "2025-07-30T08:00:00Z",
    unread: 0,
    avatar_initials: "AD",
    messages: [
      { id: "m8", sender: "Admin", content: "Please submit the weekly report by Friday.", timestamp: "2025-07-30T08:00:00Z", is_mine: false },
      { id: "m9", sender: "You", content: "Sure, I'll submit it by Thursday evening.", timestamp: "2025-07-30T08:15:00Z", is_mine: true },
    ],
  },
  {
    id: "5",
    name: "Pallavi Desai",
    role: "Customer",
    last_message: "I received the quotation, thank you!",
    last_message_time: "2025-07-26T11:00:00Z",
    unread: 0,
    avatar_initials: "PD",
    messages: [
      { id: "m10", sender: "Pallavi Desai", content: "I received the quotation, thank you!", timestamp: "2025-07-26T11:00:00Z", is_mine: false },
    ],
  },
]

export default function StaffMessagesPage() {
  const [conversations] = useState<Conversation[]>(mockConversations)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [messageInput, setMessageInput] = useState("")
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const user = useAuthStore((state) => state.user)

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  )

  const filtered = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        c.last_message.toLowerCase().includes(q)
    )
  }, [conversations, search])

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread, 0),
    [conversations]
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selected?.messages.length])

  function handleSend() {
    if (!messageInput.trim() || !selected) return
    const newMsg: Message = {
      id: `m${Date.now()}`,
      sender: "You",
      content: messageInput.trim(),
      timestamp: new Date().toISOString(),
      is_mine: true,
    }
    selected.messages.push(newMsg)
    setMessageInput("")
  }

  function getInitials(name: string): string {
    return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4 h-[600px]">
          <Skeleton className="w-80 h-full rounded-xl" />
          <Skeleton className="flex-1 h-full rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="text-muted-foreground">Communicate with customers and team</p>
      </div>

      <motion.div variants={itemVariants} className="flex h-[600px] gap-4">
        <div className={cn("w-80 shrink-0 flex flex-col", selected ? "hidden lg:flex" : "flex")}>
          <Card className="flex-1 flex flex-col">
            <CardHeader className="pb-3">
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">No conversations found</div>
              ) : (
                filtered.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedId(conversation.id)}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 text-left border-b last:border-b-0 hover:bg-muted/50 transition-colors",
                      selectedId === conversation.id && "bg-muted"
                    )}
                  >
                    <Avatar className="size-10 shrink-0">
                      <AvatarFallback className="text-xs">{conversation.avatar_initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium truncate">{conversation.name}</p>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatDate(conversation.last_message_time, "en-IN")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{conversation.last_message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{conversation.role}</Badge>
                        {conversation.unread > 0 && (
                          <span className="size-5 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
                            {conversation.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="flex-1 flex flex-col">
          {selected ? (
            <>
              <CardHeader className="pb-3 border-b flex flex-row items-center gap-3 space-y-0">
                <Button variant="ghost" size="icon" className="size-8 lg:hidden" onClick={() => setSelectedId(null)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <Avatar className="size-9 shrink-0">
                  <AvatarFallback className="text-xs">{selected.avatar_initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm">{selected.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{selected.role}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-8">
                    <Phone className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8">
                    <Mail className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8">
                    <MoreVertical className="size-4" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                {selected.messages.map((msg) => (
                  <div key={msg.id} className={cn("flex", msg.is_mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                        msg.is_mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      <p>{msg.content}</p>
                      <p className={cn("text-[10px] mt-1 opacity-70", msg.is_mine ? "text-right" : "text-left")}>
                        {new Date(msg.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </CardContent>

              <div className="p-3 border-t flex items-center gap-2">
                <Input
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend() }}
                  className="h-10"
                />
                <Button size="icon" className="size-10 shrink-0" onClick={handleSend} disabled={!messageInput.trim()}>
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <MessageSquare className="size-12 opacity-40" />
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="text-xs">Choose a conversation from the left panel to start chatting</p>
            </div>
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}
