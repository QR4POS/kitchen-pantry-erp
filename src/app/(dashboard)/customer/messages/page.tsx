"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { MessageSquare, Send, Phone, Mail } from "lucide-react"
import { formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Message } from "@/types"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const mockMessages: Message[] = [
  { id: "m1", sender_id: "team", receiver_id: "customer", content: "Welcome to Kitchen Pantry! How can we help you today?", is_read: true, created_at: "2025-07-25T09:00:00Z" },
  { id: "m2", sender_id: "customer", receiver_id: "team", content: "Hi! I wanted to check the status of my project.", is_read: true, created_at: "2025-07-25T09:15:00Z" },
  { id: "m3", sender_id: "team", receiver_id: "customer", content: "Your project is currently in production. We're on schedule and expect to complete fabrication by next week.", is_read: true, created_at: "2025-07-25T09:30:00Z" },
  { id: "m4", sender_id: "customer", receiver_id: "team", content: "That's great news! When can we expect installation to begin?", is_read: true, created_at: "2025-07-25T09:45:00Z" },
  { id: "m5", sender_id: "team", receiver_id: "customer", content: "Installation is tentatively scheduled for the week of August 18th. We'll confirm the exact dates closer to the time.", is_read: true, created_at: "2025-07-25T10:00:00Z" },
  { id: "m6", sender_id: "customer", receiver_id: "team", content: "Perfect, thanks for the update!", is_read: true, created_at: "2025-07-25T10:15:00Z" },
  { id: "m7", sender_id: "team", receiver_id: "customer", content: "You're welcome! Feel free to reach out anytime if you have questions.", is_read: true, created_at: "2025-07-25T10:30:00Z" },
  { id: "m8", sender_id: "customer", receiver_id: "team", content: "Actually, I do have a question about the cabinet color. Can we make a small change?", is_read: true, created_at: "2025-07-28T14:00:00Z" },
  { id: "m9", sender_id: "team", receiver_id: "customer", content: "Sure! Please share the details and we'll check if it's still feasible at this stage.", is_read: true, created_at: "2025-07-28T14:30:00Z" },
  { id: "m10", sender_id: "customer", receiver_id: "team", content: "I'd like to switch the lower cabinet finish from Matte White to Oak Wood. Is that possible?", is_read: false, created_at: "2025-07-30T11:00:00Z" },
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

function formatConversationTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return formatMessageTime(dateStr)
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return formatDate(dateStr)
}

export default function CustomerMessagesPage() {
  const [messages, setMessages] = useState<Message[]>(mockMessages)
  const [newMessage, setNewMessage] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const unreadCount = useMemo(
    () => messages.filter((m) => m.sender_id === "team" && !m.is_read).length,
    [messages]
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  function handleSend() {
    if (!newMessage.trim()) return
    const msg: Message = {
      id: `m${Date.now()}`,
      sender_id: "customer",
      receiver_id: "team",
      content: newMessage.trim(),
      is_read: false,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, msg])
    setNewMessage("")
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="text-muted-foreground">Chat with the Kitchen Pantry team</p>
      </div>

      <motion.div variants={itemVariants}>
        <Card className="overflow-hidden">
          <div className="flex h-[calc(100vh-16rem)]">
            {/* Left Panel - Conversation Info */}
            <div className="w-72 border-r shrink-0 flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center gap-3">
                  <Avatar className="size-12">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-primary/10 text-primary">KP</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold">Kitchen Pantry Team</p>
                    <p className="text-xs text-muted-foreground">Online</p>
                  </div>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Contact</p>
                    <div className="space-y-2">
                      <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sm" asChild>
                        <a href="tel:+919876543210">
                          <Phone className="size-4" />
                          +91 98765 43210
                        </a>
                      </Button>
                      <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sm" asChild>
                        <a href="mailto:support@kitchenpantry.com">
                          <Mail className="size-4" />
                          support@kitchenpantry.com
                        </a>
                      </Button>
                    </div>
                  </div>
                  {unreadCount > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Unread</p>
                      <Badge variant="default" className="gap-1">
                        <MessageSquare className="size-3" />
                        {unreadCount} message{unreadCount > 1 ? "s" : ""}
                      </Badge>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Response Time</p>
                    <p className="text-sm text-muted-foreground">Usually within 2-3 hours</p>
                  </div>
                </div>
              </ScrollArea>
            </div>

            {/* Right Panel - Chat Area */}
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="flex items-center gap-3 p-4 border-b shrink-0">
                <Avatar className="size-9">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">KP</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Kitchen Pantry Team</p>
                  <p className="text-xs text-emerald-500">Online</p>
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isCustomer = msg.sender_id === "customer"
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex flex-col max-w-[75%]",
                          isCustomer ? "ml-auto items-end" : "items-start"
                        )}
                      >
                        {!isCustomer && (
                          <span className="text-xs text-muted-foreground mb-1">Kitchen Pantry Team</span>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-2 text-sm break-words",
                            isCustomer
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
            </div>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
