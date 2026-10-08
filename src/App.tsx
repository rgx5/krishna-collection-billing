import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useApp, type Permission } from './state'
import { exportBackup } from './db'
import { downloadFile } from './lib/csv'
import { isDesktop, onBackupRequest, onNavigate, saveBackup, showWindow } from './lib/tauri'
import { initialsOf } from './components/ui'
import { SyncBadge } from './components/SyncBadge'
import { SafetyBanner } from './components/SafetyBanner'
import { startBackupScheduler } from './lib/backup'
import {
  BillingIcon, BillsIcon, CustomersIcon, DashboardIcon, ExpensesIcon, InventoryIcon,
  LabelsIcon, Lock, Menu, MoreIcon, Power, PurchasesIcon, ReportsIcon, SettingsIcon, StockIcon,
} from './components/icons'
import Login from './pages/Login'
import Setup from './pages/Setup'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const POS = lazy(() => import('./pages/POS'))
const Bills = lazy(() => import('./pages/Bills'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Stock = lazy(() => import('./pages/Stock'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Labels = lazy(() => import('./pages/Labels'))
const Customers = lazy(() => import('./pages/Customers'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

interface NavDef { to: string; label: string; short?: string; icon: ReactNode; perm: Permission; hint?: string }

const NAV: Array<{ group: string; items: NavDef[] }> = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <DashboardIcon />, perm: 'reports', hint: 'F9' },
    ],
  },
  {
    group: 'Counter',
    items: [
      { to: '/pos', label: 'Billing (POS)', short: 'Billing', icon: <BillingIcon />, perm: 'pos', hint: 'F1' },
      { to: '/bills', label: 'Bills & Returns', short: 'Bills', icon: <BillsIcon />, perm: 'pos' },
      { to: '/customers', label: 'Customers', icon: <CustomersIcon />, perm: 'customers' },
    ],
  },
  {
    group: 'Stock',
    items: [
      { to: '/inventory', label: 'Inventory', icon: <InventoryIcon />, perm: 'inventory' },
      { to: '/stock', label: 'Stock Control', short: 'Stock', icon: <StockIcon />, perm: 'stock' },
      { to: '/purchases', label: 'Purchases', icon: <PurchasesIcon />, perm: 'purchases' },
      { to: '/labels', label: 'Barcode Labels', short: 'Labels', icon: <LabelsIcon />, perm: 'inventory' },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/expenses', label: 'Expenses', icon: <ExpensesIcon />, perm: 'expenses' },
      { to: '/reports', label: 'Reports', icon: <ReportsIcon />, perm: 'reports' },
    ],
  },
]

/** Bottom nav can only hold a handful of destinations — the ones a counter person reaches for most. */
const BOTTOM_NAV_ORDER = ['/', '/pos', '/bills', '/inventory', '/customers']

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useApp()
  return (
    <>
      {NAV.map((group) => {
        const items = group.items.filter((i) => can(i.perm))
        if (!items.length) return null
        return (
          <div key={group.group}>
            <div className="nav-group">{group.group}</div>
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={onNavigate}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <span className="ico">{i.icon}</span>
                <span>{i.label}</span>
                {i.hint && <span className="kbd-hint">{i.hint}</span>}
              </NavLink>
            ))}
          </div>
        )
      })}
    </>
  )
}

function SidebarFoot({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, can } = useApp()
  if (!user) return null
  return (
    <div className="sidebar-foot">
      <div className="row between" style={{ padding: '2px 10px 8px' }}>
        <span className="tiny" style={{ color: '#6f7b98' }}>Data</span>
        <SyncBadge compact />
      </div>
      {can('settings') && (
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="ico"><SettingsIcon /></span><span>Settings</span>
        </NavLink>
      )}
      <div className="user-chip">
        <div className="avatar">{initialsOf(user.name)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 12.5, fontWeight: 600 }}>{user.name}</div>
          <div style={{ fontSize: 11, color: '#6f7b98', textTransform: 'capitalize' }}>{user.role}</div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: '#98a1b8' }} onClick={logout} title="Lock the counter"><Power size={15} /></button>
      </div>
    </div>
  )
}

/**
 * Desktop top bar, styled like a native Mac toolbar (see .topnav in
 * styles.css). Every destination is permanently on the bar, grouped into
 * segmented pills — Dashboard | Counter | Stock | Money — with Settings and
 * the user/lock controls on the right. Phones use the app bar + bottom nav +
 * drawer instead.
 */
function TopNav() {
  const { settings, user, logout, can } = useApp()
  if (!user) return null
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm)) })).filter((g) => g.items.length)

  return (
    <header className="topnav no-print">
      <div className="topnav-brand">
        <div className="brand-mark">KC</div>
        <span className="brand-name">{settings?.name ?? 'Krishna Collection'}</span>
      </div>

      <nav className="topnav-items" aria-label="Main navigation">
        {groups.map((g) => (
          <div key={g.group} className="topnav-seg" role="group" aria-label={g.group}>
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} title={i.hint ? `${i.label} (${i.hint})` : i.label}
                className={({ isActive }) => `topnav-item ${isActive ? 'active' : ''}`}>
                <span className="ico">{i.icon}</span>
                <span className="lbl">{i.short ?? i.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="topnav-right">
        <SyncBadge compact />
        {can('settings') && (
          <NavLink to="/settings" title="Settings" aria-label="Settings"
            className={({ isActive }) => `topnav-icon-btn ${isActive ? 'active' : ''}`}>
            <SettingsIcon size={17} />
          </NavLink>
        )}
        <div className="topnav-user">
          <div className="avatar">{initialsOf(user.name)}</div>
          <div className="topnav-user-text">
            <div className="topnav-user-name">{user.name}</div>
            <div className="topnav-user-role">{user.role}</div>
          </div>
          <button type="button" className="topnav-icon-btn" onClick={logout} title="Lock the counter" aria-label="Lock the counter">
            <Power size={16} />
          </button>
        </div>
      </div>
    </header>
  )
}

/** Full-menu slide-out drawer for phones — everything the desktop rail has, reached via the top bar. */
function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useApp()
  return (
    <>
      <div className={`drawer-backdrop no-print ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`drawer no-print ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">KC</div>
          <div>
            <div className="brand-name">{settings?.name ?? 'Krishna Collection'}</div>
            <div className="brand-sub">Billing & Inventory</div>
          </div>
        </div>
        <div className="drawer-scroll">
          <NavList onNavigate={onClose} />
        </div>
        <SidebarFoot onNavigate={onClose} />
      </aside>
    </>
  )
}

/** Android-style top app bar for phones: menu button, current section, and a lock action. */
function TopAppBar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { logout } = useApp()
  return (
    <header className="appbar no-print">
      <button className="appbar-btn" onClick={onMenu} aria-label="Open menu"><Menu size={21} /></button>
      <span className="appbar-title">{title}</span>
      <button className="appbar-btn" onClick={logout} aria-label="Lock the counter"><Power size={19} /></button>
    </header>
  )
}

/** Android-style bottom navigation: the 4 destinations staff reach for most, plus a Menu tab for the rest. */
function BottomNav({ onMore }: { onMore: () => void }) {
  const { can } = useApp()
  const location = useLocation()
  const allItems = NAV.flatMap((g) => g.items)
  const items = BOTTOM_NAV_ORDER
    .map((to) => allItems.find((i) => i.to === to))
    .filter((i): i is NavDef => !!i && can(i.perm))
    .slice(0, 4)

  return (
    <nav className="bottom-nav no-print">
      {items.map((i) => {
        const active = i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)
        return (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={`bottom-nav-item ${active ? 'active' : ''}`}>
            <span className="bottom-nav-ico">{i.icon}</span>
            <span>{i.short ?? i.label}</span>
          </NavLink>
        )
      })}
      <button className="bottom-nav-item" onClick={onMore}>
        <span className="bottom-nav-ico"><MoreIcon /></span>
        <span>Menu</span>
      </button>
    </nav>
  )
}

function Guard({ perm, children }: { perm: Permission; children: JSX.Element }) {
  const { can } = useApp()
  if (!can(perm)) {
    return (
      <div className="page">
        <div className="card"><div className="empty">
          <div className="big"><Lock size={24} /></div>
          <div className="bold">You don't have access to this section</div>
          <div className="small">Ask the owner to log in for this.</div>
        </div></div>
      </div>
    )
  }
  return children
}

export default function App() {
  const { ready, needsSetup, user, can, toast } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); navigate('/pos') }
      if (e.key === 'F9') { e.preventDefault(); navigate('/') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  // Running inside the desktop shell: File → New Bill / Dashboard route
  // through the same navigate() the F1/F9 shortcuts use.
  useEffect(() => onNavigate((path) => navigate(path)), [navigate])

  // File → Backup Data… works from any page, not just Settings, so it's
  // handled once here rather than only while the Settings screen is mounted.
  useEffect(() => onBackupRequest(async () => {
    const dump = await exportBackup()
    const json = JSON.stringify(dump, null, 2)
    if (isDesktop()) {
      const res = await saveBackup(json, `krishna-collection-backup-${new Date().toISOString().slice(0, 10)}.json`)
      if (res.ok) toast('Backup saved', 'ok')
    } else {
      downloadFile(`krishna-collection-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json')
      toast('Backup downloaded', 'ok')
    }
  }), [toast])

  // The window is created hidden so there's no flash of an unstyled frame
  // before the store data has loaded — reveal it the moment the app is
  // actually ready to show something.
  useEffect(() => { if (ready) showWindow() }, [ready])

  // Once someone is signed in, back up on the chosen schedule for as long as the app stays open.
  useEffect(() => { if (ready && user) startBackupScheduler() }, [ready, user])

  const pageTitle = useMemo(() => {
    if (location.pathname === '/settings') return 'Settings'
    const found = NAV.flatMap((g) => g.items).find((i) =>
      i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to))
    return found?.label ?? 'Krishna Collection'
  }, [location.pathname])

  if (!ready) {
    return <div className="login-wrap"><div style={{ color: '#fff', fontWeight: 600 }}>Loading store data…</div></div>
  }
  if (needsSetup) return <Setup />
  if (!user) return <Login />

  return (
    <div className="app">
      <TopNav />
      <TopAppBar title={pageTitle} onMenu={() => setDrawerOpen(true)} />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="main">
        <SafetyBanner />
        <Suspense fallback={<div className="page"><div className="skeleton" style={{ height: 120 }} /></div>}>
        <Routes>
          <Route path="/" element={can('reports') ? <Dashboard /> : <Navigate to="/pos" replace />} />
          <Route path="/pos" element={<Guard perm="pos"><POS /></Guard>} />
          <Route path="/bills" element={<Guard perm="pos"><Bills /></Guard>} />
          <Route path="/inventory" element={<Guard perm="inventory"><Inventory /></Guard>} />
          <Route path="/stock" element={<Guard perm="stock"><Stock /></Guard>} />
          <Route path="/purchases" element={<Guard perm="purchases"><Purchases /></Guard>} />
          <Route path="/labels" element={<Guard perm="inventory"><Labels /></Guard>} />
          <Route path="/customers" element={<Guard perm="customers"><Customers /></Guard>} />
          <Route path="/expenses" element={<Guard perm="expenses"><Expenses /></Guard>} />
          <Route path="/reports" element={<Guard perm="reports"><Reports /></Guard>} />
          <Route path="/settings" element={<Guard perm="settings"><Settings /></Guard>} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
        </Suspense>
      </div>
      <BottomNav onMore={() => setDrawerOpen(true)} />
    </div>
  )
}
