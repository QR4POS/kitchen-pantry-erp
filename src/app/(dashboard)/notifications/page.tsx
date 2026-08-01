"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import {
  MessageSquare,
  FolderKanban,
  CreditCard,
  FileText,
  Bell,
  Settings,
  CheckCheck,
  Mail,
  MailOpen,
  Inbox,
} from "lucide-react"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/auth/helpers"
import { useAuthStore } from "@/store/auth-store"
import { cn } from "@/utils/cn"
import type { Notification } from "@/types"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
}

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "mock-1",
    user_id: "",
    title: "New message from Rajesh Sharma",
    message: "Rajesh Sharma sent a message regarding the Andheri West kitchen project.",
    type: "message",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: "mock-2",
    user_id: "",
    title: "Project update: Powai Residence",
    message: "The Powai Residence project has moved to Installation phase.",
    type: "project",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: "mock-3",
    user_id: "",
    title: "Payment received: Rs.45,000",
    message: "A payment of Rs.45,000 has been received for the Bandra project.",
    type: "payment",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: "mock-4",
    user_id: "",
    title: "Quotation viewed by customer",
    message: "Mrs. Ananya Gupta has viewed the quotation for Juhu kitchen.",
    type: "quotation",
    is_read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: "mock-5",
    user_id: "",
    title: "Reminder: Site visit tomorrow",
    message: "You have a site visit scheduled at 10:00 AM with Vikram Patel.",
    type: "reminder",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
  },
  {
    id: "mock-6",
    user_id: "",
    title: "System maintenance tonight",
    message: "The system will be under maintenance from 2:00 AM to 4:00 AM.",
    type: "system",
    is_read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "mock-7",
    user_id: "",
    title: "New staff member added",
    message: "Priya Singh has been added to the staff team.",
    type: "system",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
  {
    id: "mock-8",
    user_id: "",
    title: "Message from contractor: Sunil Verma",
    message: "Sunil Verma has submitted the progress report for Malad project.",
    type: "message",
    is_read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: "mock-9",
    user_id: "",
    title: "Project completed: Dadar Office",
    message: "The Dadar office kitchen project has been marked as completed.",
    type: "project",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "mock-10",
    user_id: "",
    title: "Payment overdue: Rs.12,500",
    message: "Payment of Rs.12,500 for the Worli project is past due.",
    type: "payment",
    is_read: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
  {
    id: "mock-11",
    user_id: "",
    title: "New quotation generated",
    message: "Quotation Q-2024-0042 has been generated for Chembur project.",
    type: "quotation",
    is_read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
  {
    id: "mock-12",
    user_id: "",
    title: "Reminder: Follow up with customer",
    message: "Follow up with Ms. Pallavi Desai regarding the quotation sent 5 days ago.",
    type: "reminder",
    is_read: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(),
  },
]

const typeIcons: Record<string, React.ElementType> = {
  message: MessageSquare,
  project: FolderKanban,
  payment: CreditCard,
  quotation: FileText,
  reminder: Bell,
  system: Settings,
}

const typeBadgeVariant: Record<string, "default" | "secondary" | "success" | "warning" | "outline"> = {
  message: "default",
  project: "secondary",
  payment: "success",
  quotation: "warning",
  reminder: "outline",
  system: "secondary",
}

function getIcon(type: string | undefined) {
  const Icon = typeIcons[type ?? ""] ?? Bell
  return Icon
}

function getBadgeVariant(type: string | undefined) {
  return typeBadgeVariant[type ?? ""] ?? "outline"
}

function NotificationSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-start gap-4 py-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("all")
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications(MOCK_NOTIFICATIONS)
      setLoading(false)
      return
    }
    try {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      if (data && data.length > 0) {
        setNotifications(data as Notification[])
      } else {
        setNotifications(MOCK_NOTIFICATIONS)
      }
    } catch {
      setNotifications(MOCK_NOTIFICATIONS)
    } finally {
      setLoading(false)
    }
  }, [supabase, user?.id])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  async function markAsRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    )

    if (!user?.id) return

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
  }

  async function markAllAsRead() {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true }))
    )

    if (!user?.id) return

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false)
  }

  const filtered = activeTab === "unread"
    ? notifications.filter((n) => !n.is_read)
    : notifications

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground text-sm">
            Stay updated with your latest activity
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={markAllAsRead}
          >
            <CheckCheck className="size-4 mr-1.5" />
            Mark All Read
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2">
            <Inbox className="size-4" />
            All
          </TabsTrigger>
          <TabsTrigger value="unread" className="gap-2">
            <Mail className="size-4" />
            Unread
            {unreadCount > 0 && (
              <Badge variant="default" className="ml-1 size-5 rounded-full p-0 text-[10px] leading-none flex items-center justify-center">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {renderContent(filtered, loading, markAsRead)}
        </TabsContent>

        <TabsContent value="unread" className="mt-4">
          {renderContent(filtered, loading, markAsRead)}
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}

function renderContent(
  notifications: Notification[],
  loading: boolean,
  onMarkAsRead: (id: string) => void
) {
  if (loading) return <NotificationSkeleton />

  if (notifications.length === 0) {
    return (
      <motion.div
        variants={itemVariants}
        className="flex flex-col items-center justify-center py-16 text-center"
      >
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MailOpen className="size-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium">All caught up!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          No notifications to show right now.
        </p>
      </motion.div>
    )
  }

  return (
    <div className="space-y-3">
      {notifications.map((notification, index) => {
        const Icon = getIcon(notification.type)
        const isUnread = !notification.is_read

        return (
          <motion.div
            key={notification.id}
            variants={itemVariants}
            initial="hidden"
            animate="visible"
            transition={{ delay: index * 0.03 }}
          >
            <Card
              className={cn(
                "cursor-pointer transition-colors hover:bg-accent/50",
                isUnread && "border-l-2 border-l-primary"
              )}
              onClick={() => {
                if (isUnread) onMarkAsRead(notification.id)
              }}
            >
              <CardContent className="flex items-start gap-4 py-4">
                <div
                  className={cn(
                    "size-10 shrink-0 rounded-full flex items-center justify-center",
                    isUnread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        "text-sm truncate",
                        isUnread ? "font-semibold" : "font-medium text-muted-foreground"
                      )}
                    >
                      {notification.title}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      {formatDate(notification.created_at)}
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                    {notification.message}
                  </p>

                  <div className="flex items-center gap-2 mt-2">
                    {notification.type && (
                      <Badge variant={getBadgeVariant(notification.type)} className="capitalize">
                        {notification.type}
                      </Badge>
                    )}
                    {isUnread && (
                      <span className="text-xs text-primary font-medium">New</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}
