export function initNotificationBell(supabase, userId) {
  // Inject CSS once
  if (!document.getElementById('notif-styles')) {
    const style = document.createElement('style')
    style.id = 'notif-styles'
    style.textContent = `
      .notif-wrap { position: relative; margin-left: auto; }
      .notif-btn { width: 36px; height: 36px; border-radius: 8px; border: 1.5px solid #E0E0E0; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #555; position: relative; flex-shrink: 0; }
      .notif-btn:hover { border-color: #560591; color: #560591; }
      .notif-badge { position: absolute; top: -4px; right: -4px; background: #DC2626; color: #fff; font-size: 9px; font-weight: 700; min-width: 16px; height: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 0 3px; border: 1.5px solid #fff; }
      .notif-dropdown { position: absolute; top: 44px; right: 0; width: 340px; background: #fff; border: 1.5px solid #E0E0E0; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.10); z-index: 9999; display: none; overflow: hidden; }
      .notif-header { padding: 14px 16px 10px; border-bottom: 1px solid #F0F0F0; display: flex; align-items: center; justify-content: space-between; }
      .notif-title { font-size: 13px; font-weight: 700; color: #0D0D0D; }
      .notif-mark-all { font-size: 11px; color: #560591; font-weight: 600; cursor: pointer; background: none; border: none; font-family: inherit; }
      .notif-list { max-height: 340px; overflow-y: auto; }
      .notif-item { padding: 12px 16px; border-bottom: 1px solid #F9F9F9; cursor: pointer; display: flex; gap: 10px; align-items: flex-start; transition: background 0.1s; }
      .notif-item:hover { background: #FAFAFA; }
      .notif-item.unread { background: #F5EEFF; }
      .notif-item.unread:hover { background: #EDE4F7; }
      .notif-dot { width: 8px; height: 8px; border-radius: 50%; background: #560591; flex-shrink: 0; margin-top: 5px; }
      .notif-dot.read { background: transparent; }
      .notif-item-msg { font-size: 12px; color: #333; line-height: 1.5; flex: 1; }
      .notif-item-time { font-size: 10px; color: #aaa; margin-top: 3px; }
      .notif-empty { padding: 32px 16px; text-align: center; font-size: 13px; color: #aaa; }
    `
    document.head.appendChild(style)
  }

  // Inject bell HTML into topbar
  const topbar = document.querySelector('.topbar')
  if (!topbar) return

  const wrap = document.createElement('div')
  wrap.className = 'notif-wrap'
  wrap.innerHTML = `
    <button class="notif-btn" id="notifBtn">
      <i class="ti ti-bell"></i>
      <span class="notif-badge" id="notifBadge" style="display:none"></span>
    </button>
    <div class="notif-dropdown" id="notifDropdown">
      <div class="notif-header">
        <div class="notif-title">Notifications</div>
        <button class="notif-mark-all" id="notifMarkAll">Mark all read</button>
      </div>
      <div class="notif-list" id="notifList">
        <div class="notif-empty">You're all caught up</div>
      </div>
    </div>
  `
  topbar.appendChild(wrap)

  let notifications = []
  let dropdownOpen = false
  let markReadTimer = null

  async function loadNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50)
    return data || []
  }

  function relativeTime(dateStr) {
    const now = new Date()
    const date = new Date(dateStr)
    const diffMs = now - date
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHr = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHr / 24)

    if (diffSec < 60) return 'Just now'
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`
    if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`
    if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`
    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  }

  function renderDropdown() {
    const list = document.getElementById('notifList')
    const badge = document.getElementById('notifBadge')
    if (!list || !badge) return

    const unreadCount = notifications.filter(n => !n.is_read).length

    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount
      badge.style.display = 'flex'
    } else {
      badge.style.display = 'none'
    }

    if (notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">You\'re all caught up</div>'
      return
    }

    list.innerHTML = notifications.map(item => `
      <div class="notif-item ${item.is_read ? '' : 'unread'}" data-id="${item.id}" data-inspection="${item.inspection_id || ''}">
        <div class="notif-dot ${item.is_read ? 'read' : ''}"></div>
        <div style="flex:1">
          <div class="notif-item-msg">${item.message}</div>
          <div class="notif-item-time">${relativeTime(item.created_at)}</div>
        </div>
      </div>
    `).join('')

    // Attach click handlers for navigation
    list.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', () => {
        const inspId = el.dataset.inspection
        if (inspId) {
          // Determine path based on current page location
          const path = window.location.pathname
          if (path.includes('/scout/')) {
            window.location.href = `inspection-detail.html?id=${inspId}`
          } else if (path.includes('/client/')) {
            window.location.href = `inspection-detail.html?id=${inspId}`
          } else {
            window.location.href = `inspection-detail.html?id=${inspId}`
          }
        }
        closeDropdown()
      })
    })
  }

  async function refreshBadge() {
    const { data } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('is_read', false)
      .limit(100)

    const badge = document.getElementById('notifBadge')
    if (!badge) return
    const count = (data || []).length
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count
      badge.style.display = 'flex'
    } else {
      badge.style.display = 'none'
    }
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    notifications = []
    renderDropdown()
  }

  function openDropdown() {
    const dropdown = document.getElementById('notifDropdown')
    if (!dropdown) return
    dropdown.style.display = 'block'
    dropdownOpen = true

    // Load notifications and render
    loadNotifications().then(data => {
      notifications = data
      renderDropdown()
    })

    // Mark all read after 1 second
    markReadTimer = setTimeout(() => {
      markAllRead()
    }, 1000)
  }

  function closeDropdown() {
    const dropdown = document.getElementById('notifDropdown')
    if (!dropdown) return
    dropdown.style.display = 'none'
    dropdownOpen = false
    if (markReadTimer) {
      clearTimeout(markReadTimer)
      markReadTimer = null
    }
  }

  // Bell button click
  document.getElementById('notifBtn').addEventListener('click', (e) => {
    e.stopPropagation()
    if (dropdownOpen) {
      closeDropdown()
    } else {
      openDropdown()
    }
  })

  // Mark all read button
  document.getElementById('notifMarkAll').addEventListener('click', (e) => {
    e.stopPropagation()
    markAllRead()
  })

  // Click outside to close
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.notif-wrap')
    if (dropdownOpen && wrap && !wrap.contains(e.target)) {
      closeDropdown()
    }
  })

  // Initial badge load
  loadNotifications().then(data => {
    notifications = data
    renderDropdown()
  })

  // Auto-refresh every 60 seconds
  setInterval(() => refreshBadge(), 60000)
}
