"use client"

import { useMemo } from "react"
import { cn } from "@/utils/cn"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SearchInput } from "@/components/shared/search-input"
import { formatDate } from "@/lib/auth/helpers"

interface Conversation {
  id: string
  name: string
  avatar_initials: string
  last_message?: string
  last_message_time?: string
  unread?: number
}

interface ConversationListProps {
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
  search?: string
  onSearchChange?: (query: string) => void
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  search = "",
  onSearchChange,
}: ConversationListProps) {
  const filtered = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.last_message?.toLowerCase().includes(q)
    )
  }, [conversations, search])

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <SearchInput
          value={search}
          onChange={(q) => onSearchChange?.(q)}
          placeholder="Search conversations..."
        />
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No conversations found
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 text-left border-b last:border-b-0 hover:bg-muted/50 transition-colors",
                  selectedId === conversation.id && "bg-muted"
                )}
              >
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="text-xs">
                    {conversation.avatar_initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{conversation.name}</p>
                    {conversation.last_message_time && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDate(conversation.last_message_time, "en-IN")}
                      </span>
                    )}
                  </div>
                  {conversation.last_message && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {conversation.last_message}
                    </p>
                  )}
                  {conversation.unread !== undefined && conversation.unread > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="default"
                        className="size-5 rounded-full p-0 flex items-center justify-center text-[10px] font-medium"
                      >
                        {conversation.unread}
                      </Badge>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
