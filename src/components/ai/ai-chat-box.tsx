"use client"

import { useState, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Send, Bot, User, Loader2 } from "lucide-react"
import { cn } from "@/utils/cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface AIChatBoxProps {
  apiEndpoint?: string
  title?: string
  className?: string
  initialMessage?: string
  context?: Record<string, string>
}

export function AIChatBox({
  apiEndpoint = "/api/ai/chat",
  title = "AI Assistant",
  className,
  initialMessage = "Hello! I'm your Kitchen Pantry AI assistant. How can I help you today?",
  context,
}: AIChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: initialMessage },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function handleSend() {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput("")
    setMessages(prev => [...prev, { role: "user", content: userMessage }])
    setLoading(true)

    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, ...context }),
      })

      if (!response.ok) throw new Error("AI request failed")

      const data = await response.json()
      setMessages(prev => [...prev, { role: "assistant", content: data.content || "I'm not sure how to respond to that." }])
    } catch {
      // Fallback response
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "I apologize, but I'm having trouble connecting. Please try again later or contact support.",
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col h-full rounded-lg border bg-card", className)}>
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        <Bot className="size-5 text-primary" />
        <span className="text-sm font-medium">{title}</span>
      </div>

      <ScrollArea ref={scrollRef as React.Ref<HTMLDivElement>} className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              {msg.role === "assistant" && (
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    <Bot className="size-4" />
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
              {msg.role === "user" && (
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    <User className="size-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </motion.div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  <Bot className="size-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="size-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything..."
            disabled={loading}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
