import { FC, MouseEvent, ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { NavigationProps, PageType } from '../types'
import { getStorageItem, setStorageItem } from '../utils/storage'
import { useGoals } from '../contexts/GoalsContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLayout } from '../contexts/LayoutContext'
import SidebarToggle from './SidebarToggle'
import {
  HomeIcon,
  SearchIcon,
  GoalsIcon,
  NetWorthIcon,
  CashflowIcon,
  DriveIcon,
  GuideIcon,
  ChevronIcon,
} from './SidebarIcons'
import { NAV_GROUPS, NavGroup, NavGroupId, getActiveChildId, isNavGroupId } from './sidebarNavConfig'
import { SettingsMenu } from '../pages/settings'
import type { SettingsSection } from '../pages/settings/types'
import '../styles/SidebarNavigation.css'

interface NavItemProps {
  page: PageType
  label: string
  icon: ReactNode
  collapsed: boolean
  currentPage: PageType
  setCurrentPage: (page: PageType) => void
}

const NavItem: FC<NavItemProps> = ({ page, label, icon, collapsed, currentPage, setCurrentPage }) => (
  <li className="sidebar-item">
    <button
      className={`sidebar-link${currentPage === page ? ' active' : ''}`}
      onClick={() => setCurrentPage(page)}
      aria-current={currentPage === page ? 'page' : undefined}
      title={collapsed ? label : undefined}
    >
      {icon}
      <span className="sidebar-label">{label}</span>
    </button>
  </li>
)

const GROUP_ICONS: Record<NavGroupId, ReactNode> = {
  goal: <GoalsIcon />,
  'net-worth': <NetWorthIcon />,
  budget: <CashflowIcon />,
}

const isPlainLeftClick = (e: MouseEvent<HTMLElement>): boolean =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

const readOpenGroups = (activeGroup: NavGroupId | undefined): NavGroupId[] => {
  const stored = getStorageItem('sidebar-open-groups', []).filter(isNavGroupId)
  return activeGroup && !stored.includes(activeGroup) ? [...stored, activeGroup] : stored
}

interface NavGroupItemProps {
  group: NavGroup
  collapsed: boolean
  active: boolean
  expanded: boolean
  pathname: string
  onHeaderClick: (group: NavGroup) => void
  onChildClick: (e: MouseEvent<HTMLAnchorElement>, path: string) => void
}

const NavGroupItem: FC<NavGroupItemProps> = ({
  group,
  collapsed,
  active,
  expanded,
  pathname,
  onHeaderClick,
  onChildClick,
}) => {
  const listId = `sidebar-group-${group.id}`
  const activeChildId = active ? getActiveChildId(group, pathname) : undefined
  const showChildren = !collapsed && expanded
  return (
    <li className={`sidebar-item sidebar-group${showChildren ? ' expanded' : ''}`}>
      <button
        type="button"
        className={`sidebar-link${active ? ' active' : ''}`}
        onClick={() => onHeaderClick(group)}
        aria-current={active ? 'true' : undefined}
        aria-expanded={collapsed ? undefined : expanded}
        aria-controls={collapsed || !expanded ? undefined : listId}
        title={collapsed ? group.label : undefined}
      >
        {GROUP_ICONS[group.id]}
        <span className="sidebar-label">{group.label}</span>
        {!collapsed && <ChevronIcon />}
      </button>
      {showChildren && (
        <ul id={listId} className="sidebar-sublist">
          {group.children.map(child => (
            <li key={child.id} className="sidebar-subitem">
              <Link
                to={child.path}
                className={`sidebar-link sidebar-sublink${activeChildId === child.id ? ' active' : ''}`}
                aria-current={activeChildId === child.id ? 'page' : undefined}
                onClick={e => onChildClick(e, child.path)}
              >
                {child.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const SidebarNavigation: FC<NavigationProps> = ({ currentPage, setCurrentPage, navigateTo }) => {
  const routerNavigate = useNavigate()
  const { pathname } = useLocation()
  const go = navigateTo ?? routerNavigate
  const { darkMode, setDarkMode, allowCsvImport, setAllowCsvImport } = useSettings()
  const { profile, updateProfile } = useGoals()
  const { sidebarOpen, setSidebarOpen, settingsOpenSection, setSettingsOpenSection, setSearchOpen } = useLayout()
  const collapsed = !sidebarOpen
  const itemProps = { collapsed, currentPage, setCurrentPage }
  const activeGroup = isNavGroupId(currentPage) ? currentPage : undefined
  const [openGroups, setOpenGroups] = useState<NavGroupId[]>(() => readOpenGroups(activeGroup))

  // Entering a group from anywhere (a link, search, a deep link) opens it.
  useEffect(() => {
    if (activeGroup) setOpenGroups(prev => (prev.includes(activeGroup) ? prev : [...prev, activeGroup]))
  }, [activeGroup])

  useEffect(() => {
    try {
      setStorageItem('sidebar-open-groups', openGroups)
    } catch {
      // Storage can be unavailable or full; expansion then lasts for the session only.
    }
  }, [openGroups])

  const handleHeaderClick = useCallback(
    (group: NavGroup) => {
      if (group.id !== activeGroup) {
        setOpenGroups(prev => (prev.includes(group.id) ? prev : [...prev, group.id]))
        go(group.defaultPath)
        return
      }
      if (collapsed) return
      setOpenGroups(prev => (prev.includes(group.id) ? prev.filter(id => id !== group.id) : [...prev, group.id]))
    },
    [activeGroup, collapsed, go],
  )

  const handleChildClick = (e: MouseEvent<HTMLAnchorElement>, path: string): void => {
    if (!isPlainLeftClick(e)) return
    e.preventDefault()
    go(path)
  }

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Main navigation">
      <div className="sidebar-top-row">
        <div className="sidebar-logo">Worth</div>
        <div className="sidebar-header-actions">
          {sidebarOpen && (
            <button
              className="sidebar-search-btn"
              aria-label="Search"
              title="Search"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon />
            </button>
          )}
          <SidebarToggle expanded={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        </div>
      </div>
      <ul className="sidebar-menu">
        <NavItem page="home" label="Home" icon={<HomeIcon />} {...itemProps} />
        {NAV_GROUPS.map(group => (
          <NavGroupItem
            key={group.id}
            group={group}
            collapsed={collapsed}
            active={group.id === activeGroup}
            expanded={openGroups.includes(group.id)}
            pathname={pathname}
            onHeaderClick={handleHeaderClick}
            onChildClick={handleChildClick}
          />
        ))}
      </ul>
      <ul className="sidebar-menu sidebar-footer-menu" role="group" aria-label="Utilities">
        <NavItem page="drive" label="Drive" icon={<DriveIcon />} {...itemProps} />
        <li className="sidebar-item">
          <SettingsMenu
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode(!darkMode)}
            profile={profile}
            onUpdateProfile={updateProfile}
            allowCsvImport={allowCsvImport}
            onToggleAllowCsvImport={() => setAllowCsvImport(v => !v)}
            externalOpen={!!settingsOpenSection}
            externalSection={settingsOpenSection as SettingsSection | undefined}
            onExternalClose={() => setSettingsOpenSection(undefined)}
            iconOnly={collapsed}
          />
        </li>
        <NavItem page="guide" label="User Guide" icon={<GuideIcon />} {...itemProps} />
      </ul>
    </nav>
  )
}

export default SidebarNavigation
