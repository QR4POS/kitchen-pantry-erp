"use client"

import { FileIcon, Download } from "lucide-react"
import { cn } from "@/utils/cn"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { formatDate } from "@/lib/auth/helpers"

interface ReplyInfo {
  sender: string
  content: string
}

interface MessageBubbleProps {
  message: string
  sender: string
  time: string
  isOwn: boolean
  avatar?: string
  messageType?: "text" | "image" | "file"
  fileUrl?: string
  replyTo?: ReplyInfo
}

export function MessageBubble({
  message,
  sender,
  time,
  isOwn,
  avatar,
  messageType = "text",
  fileUrl,
  replyTo,
}: MessageBubbleProps) {
  return (
    <div className={cn("flex gap-2", isOwn ? "flex-row-reverse" : "flex-row")}>
      <Avatar className="size-8 shrink-0 mt-1">
        {avatar ? <AvatarImage src={avatar} /> : null}
        <AvatarFallback className="text-xs">{sender.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className={cn("flex flex-col max-w-[75%]", isOwn && "items-end")}>
        <span className="text-xs text-muted-foreground mb-0.5">{sender}</span>
        {replyTo && (
          <div className={cn(
            "text-xs rounded-md px-3 py-1.5 mb-1 border-l-2 max-w-full",
            isOwn
              ? "bg-primary/20 border-primary-foreground/40 text-primary-foreground/80"
              : "bg-muted-foreground/10 border-muted-foreground/30"
          )}>
            <span className="font-medium">{replyTo.sender}</span>
            <p className="truncate">{replyTo.content}</p>
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-sm break-words",
            isOwn
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted rounded-bl-md"
          )}
        >
          {messageType === "image" && fileUrl ? (
            <div className="space-y-1">
              <img
                src={fileUrl}
                alt={message}
                className="rounded-lg max-w-full max-h-64 object-cover"
              />
              {message && <p className="text-sm">{message}</p>}
            </div>
          ) : messageType === "file" && fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center gap-2 rounded-lg p-2 transition-colors",
                isOwn
                  ? "hover:bg-primary-foreground/10"
                  : "hover:bg-muted-foreground/10"
              )}
            >
              <FileIcon className="size-5 shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{message}</span>
              <Download className="size-4 shrink-0" />
            </a>
          ) : (
            <p>{message}</p>
          )}
        </div>
        <span className={cn(
          "text-[10px] text-muted-foreground mt-0.5",
          isOwn ? "text-right" : "text-left"
        )}>
          {formatDate(time)}
        </span>
      </div>
    </div>
  )
}
