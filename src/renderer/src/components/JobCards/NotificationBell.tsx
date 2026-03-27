import React, { useState, useEffect, useRef } from 'react'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'

interface AppNotification {
    id: string
    userId?: string
    role?: string
    title: string
    message: string
    read: boolean
    createdAt: any
    linkToJobCard?: string
    jobCardId?: string
    targetPhase?: number
}

interface NotificationBellProps {
    onNotificationClick?: (jobCardId: string, phase: number, jobNum?: string) => void
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNotificationClick }) => {
    const { user } = useAuth()
    const [notifications, setNotifications] = useState<AppNotification[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (user && user.role) {
            console.log(`[NotificationBell] Active Role: ${user.role}, UID: ${user.uid}`);
            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `NotificationBell: User ${user.uid} (Role: ${user.role}) is listening for notifications.`);
            }
        }
    }, [user?.role]);

    // Track the time when the component was loaded to avoid notifying about old items
    const [lastProcessedTime] = useState(Date.now())

    useEffect(() => {
        if (!user || !user.role) return

        const q = query(
            collection(db, 'notifications'),
            where('role', '==', user.role)
        )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const data = change.doc.data() as AppNotification;
                    const createdAtTime = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();

                    // Only trigger system notification for items created AFTER the app started
                    // and that are UNREAD.
                    if (createdAtTime > lastProcessedTime && !data.read) {
                        if (window.electron && window.electron.ipcRenderer) {
                            window.electron.ipcRenderer.send('show-notification', {
                                title: data.title || 'Job Card Update',
                                body: data.message || 'You have a new update.',
                                jobCardId: data.jobCardId,
                                targetPhase: data.targetPhase
                            });
                        }
                    }
                }
            });

            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as AppNotification[]

            // Sort in memory if index is missing
            const sortedData = data.sort((a, b) => {
                const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
                const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
                return timeB - timeA;
            });

            setNotifications(sortedData)
        }, (error) => {
            console.error("Notification query failed:", error);
            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `Notification query failed for role ${user.role}: ${error.message}`);
            }
        })

        return () => unsubscribe()
    }, [user, lastProcessedTime])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleMarkRead = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            await updateDoc(doc(db, 'notifications', id), { read: true })
        } catch (error) {
            console.error("Error marking notification read", error)
        }
    }

    const unreadCount = notifications.filter(n => !n.read).length

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 text-gray-600 hover:text-gray-900 focus:outline-none transition rounded-full hover:bg-gray-100"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-1 text-xs font-bold leading-none text-red-100 bg-red-600 rounded-full transform translate-x-1/4 -translate-y-1/4 ring-2 ring-white animate-pulse">
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-md shadow-lg overflow-hidden z-50 border border-gray-100 ring-1 ring-black ring-opacity-5">
                    <div className="px-4 py-3 border-b bg-gray-50 flex justify-between items-center">
                        <div className="flex flex-col">
                            <h3 className="text-sm font-bold text-gray-700">Notifications</h3>
                            <span className="text-[10px] text-gray-400">UID: {user?.uid?.substring(0, 6)}...</span>
                            <span className="text-[10px] text-gray-400">Role: {user?.role || 'None'}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-xs text-gray-500">{unreadCount} unread</span>
                            <span className="text-[10px] text-gray-400">Total: {notifications.length}</span>
                        </div>
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-4 text-center text-sm text-gray-500">
                                No notifications to display.
                            </div>
                        ) : (
                            notifications.map(notification => (
                                <div
                                    key={notification.id}
                                    onClick={async () => {
                                        console.log("[NotificationBell] Notification clicked:", notification.id, notification.jobCardId, notification.targetPhase);
                                        if (!notification.read) {
                                            await handleMarkRead(notification.id, { stopPropagation: () => { } } as any);
                                        }

                                        if (onNotificationClick) {
                                            const jobNum = notification.linkToJobCard || '';
                                            console.log("[NotificationBell] Triggering callback with ID:", notification.jobCardId, "Num:", jobNum);
                                            onNotificationClick(notification.jobCardId || '', notification.targetPhase || 1, jobNum);
                                            setIsOpen(false);
                                        } else {
                                            console.error("[NotificationBell] onNotificationClick callback is missing!");
                                        }
                                    }}
                                    className={`p-4 border-b hover:bg-gray-50 transition cursor-pointer ${!notification.read ? 'bg-blue-50/30' : ''}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className={`text-sm ${!notification.read ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                                            {notification.title}
                                        </h4>
                                        {!notification.read && (
                                            <button
                                                onClick={(e) => handleMarkRead(notification.id, e)}
                                                className="text-xs text-blue-600 hover:text-blue-800"
                                            >
                                                Mark read
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                                    <span className="text-xs text-gray-400 mt-2 block">
                                        {notification.createdAt?.toDate ? notification.createdAt.toDate().toLocaleString() : 'Just now'}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
