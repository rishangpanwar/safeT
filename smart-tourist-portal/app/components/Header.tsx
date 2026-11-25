'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ShieldCheck, User, LogOut, UserPlus, Bell, HeartPulse, LayoutDashboard, Stethoscope, AlertTriangle,
  Menu, X, MapPin, BellRing, ClipboardList, Download, Share, Gauge,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { usePwa } from "../contexts/PwaContext";

type NavItem = { href: string; label: string; short?: string; icon: React.ComponentType<{ className?: string }>; show?: boolean };

const Header = () => {
  const { user, logout } = useAuth();
  const { canInstall, install, isIos, isStandalone } = usePwa();
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  // Close menus on navigation.
  useEffect(() => {
    setDrawer(false);
    setShowUserMenu(false);
  }, [pathname]);

  // Lock page scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const p = user?.permissions;
  const nav: NavItem[] = user
    ? [
        { href: "/dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard },
        { href: "/triage", label: "Clinical Triage", short: "Triage", icon: HeartPulse },
        { href: "/alerts", label: "Alerts", icon: AlertTriangle },
        { href: "/responder", label: "Responder", icon: Stethoscope },
        { href: "/high-risk-zones", label: "High-Risk Zones", icon: MapPin },
        { href: "/notifications", label: "Notifications", icon: BellRing },
        { href: "/accuracy", label: "Model Accuracy", icon: Gauge },
        { href: "/register", label: "Register Tourist", icon: ClipboardList, show: p?.canRegisterTourists },
        { href: "/send-notification", label: "Send Notification", icon: Bell, show: p?.canSendNotifications },
        { href: "/create-agent", label: "Create Agent", icon: UserPlus, show: p?.canCreateAgents },
      ].filter((n) => n.show !== false)
    : [];
  const tabs = nav.filter((n) => ["/dashboard", "/triage", "/alerts", "/responder"].includes(n.href));
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const showInstall = !isStandalone && (canInstall || isIos);

  const onInstall = () => {
    if (canInstall) install();
    else setIosHint(true);
  };

  return (
    <>
      <header className="sticky top-0 z-[1100] bg-white shadow-md pt-[env(safe-area-inset-top)]">
        <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-3 sm:h-16">
            <Link href={user ? "/dashboard" : "/"} className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-7 w-7 shrink-0 text-blue-600 sm:h-8 sm:w-8" />
              <span className="truncate text-lg font-bold text-gray-800 sm:text-xl">
                <span className="sm:hidden">SafeT Command</span>
                <span className="hidden sm:inline">Tourist Health &amp; Safety</span>
              </span>
            </Link>

            {/* Desktop navigation */}
            <div className="hidden items-center gap-1 xl:flex">
              {user ? (
                <>
                  {nav
                    .filter((n) => !["/high-risk-zones", "/notifications", "/accuracy", "/send-notification", "/create-agent"].includes(n.href))
                    .map((n) => (
                      <Link
                        key={n.href}
                        href={n.href}
                        className={`flex items-center gap-1 rounded-md px-3 py-2 font-medium ${active(n.href) ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:text-blue-600"}`}
                      >
                        {n.href === "/triage" && <HeartPulse className="h-4 w-4 text-red-600" />}
                        {n.label}
                      </Link>
                    ))}
                  {p?.canCreateAgents && (
                    <Link href="/create-agent" className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-green-700">
                      <UserPlus className="h-4 w-4" />
                      <span>Create Agent</span>
                    </Link>
                  )}
                  {p?.canSendNotifications && (
                    <Link href="/send-notification" className="ml-2 flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-700">
                      <Bell className="h-4 w-4" />
                      <span>Send Notification</span>
                    </Link>
                  )}

                  <div className="relative ml-2">
                    <button
                      onClick={() => setShowUserMenu(!showUserMenu)}
                      className="flex items-center gap-2 rounded-md px-3 py-2 font-medium text-gray-600 hover:text-blue-600"
                    >
                      <User className="h-5 w-5" />
                      <span>{user.profile.fullName || user.username}</span>
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800">{user.role === 'government' ? 'Gov' : 'Agent'}</span>
                    </button>
                    {showUserMenu && (
                      <div className="absolute right-0 z-50 mt-2 w-56 rounded-md bg-white py-1 shadow-lg">
                        <div className="border-b px-4 py-2 text-sm text-gray-700">
                          <div className="font-medium">{user.profile.fullName}</div>
                          <div className="text-gray-500">{user.email}</div>
                          <div className="text-xs text-blue-600">{user.role === 'government' ? `ID: ${user.governmentId}` : `Agent: ${user.agentId}`}</div>
                        </div>
                        <Link href="/accuracy" className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                          <Gauge className="h-4 w-4" /> Model accuracy
                        </Link>
                        {showInstall && (
                          <button onClick={onInstall} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                            <Download className="h-4 w-4" /> Install app
                          </button>
                        )}
                        <button
                          onClick={() => {
                            logout();
                            setShowUserMenu(false);
                          }}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>Logout</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {showInstall && (
                    <button onClick={onInstall} className="flex items-center gap-1 rounded-md px-3 py-2 font-medium text-gray-600 hover:text-blue-600">
                      <Download className="h-4 w-4" /> Install app
                    </button>
                  )}
                  <Link href="/login" className="rounded-md px-3 py-2 font-medium text-gray-600 hover:text-blue-600">Login</Link>
                  <Link href="/admin-register" className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-700">Register</Link>
                </>
              )}
            </div>

            {/* Mobile: install shortcut + menu button */}
            <div className="flex items-center gap-1 xl:hidden">
              {showInstall && (
                <button onClick={onInstall} aria-label="Install app" className="rounded-md p-2 text-blue-700 hover:bg-blue-50">
                  <Download className="h-5 w-5" />
                </button>
              )}
              {!user && (
                <Link href="/login" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">Login</Link>
              )}
              <button onClick={() => setDrawer(!drawer)} aria-label={drawer ? "Close menu" : "Open menu"} aria-expanded={drawer} className="rounded-md p-2 text-gray-700 hover:bg-gray-100">
                {drawer ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </nav>

        {/* Mobile menu */}
        {drawer && (
          <div className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] xl:hidden">
            {user ? (
              <>
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-800"><User className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">{user.profile.fullName || user.username}</p>
                    <p className="truncate text-xs text-gray-500">{user.role === 'government' ? `Government · ${user.governmentId}` : `Agent · ${user.agentId}`}</p>
                  </div>
                </div>
                <ul className="py-1">
                  {nav.map((n) => (
                    <li key={n.href}>
                      <Link href={n.href} className={`flex items-center gap-3 px-4 py-3 text-base ${active(n.href) ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-800 hover:bg-gray-50"}`}>
                        <n.icon className="h-5 w-5 shrink-0" />
                        {n.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="border-t py-1">
                  {showInstall && (
                    <button onClick={onInstall} className="flex w-full items-center gap-3 px-4 py-3 text-left text-base text-gray-800 hover:bg-gray-50">
                      <Download className="h-5 w-5" /> Install app on this phone
                    </button>
                  )}
                  <button onClick={() => logout()} className="flex w-full items-center gap-3 px-4 py-3 text-left text-base text-gray-800 hover:bg-gray-50">
                    <LogOut className="h-5 w-5" /> Logout
                  </button>
                </div>
              </>
            ) : (
              <ul className="py-1">
                <li><Link href="/" className="block px-4 py-3 text-base text-gray-800 hover:bg-gray-50">Home</Link></li>
                <li><Link href="/login" className="block px-4 py-3 text-base text-gray-800 hover:bg-gray-50">Login</Link></li>
                <li><Link href="/admin-register" className="block px-4 py-3 text-base text-gray-800 hover:bg-gray-50">Register as official</Link></li>
                <li><Link href="/responder" className="block px-4 py-3 text-base text-gray-800 hover:bg-gray-50">First responder</Link></li>
                {showInstall && (
                  <li>
                    <button onClick={onInstall} className="flex w-full items-center gap-3 px-4 py-3 text-left text-base text-gray-800 hover:bg-gray-50">
                      <Download className="h-5 w-5" /> Install app on this phone
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </header>

      {/* App-style bottom tab bar on phones and tablets */}
      {user && (
        <nav className="fixed inset-x-0 bottom-0 z-[1100] border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
          <ul className="grid grid-cols-4">
            {tabs.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active(n.href) ? "text-blue-700" : "text-gray-500"}`}>
                  <n.icon className={`h-5 w-5 ${n.href === "/triage" && !active(n.href) ? "text-red-600" : ""}`} />
                  {n.short ?? n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* iOS has no install prompt: explain the Share-sheet route */}
      {iosHint && (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setIosHint(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-lg font-semibold text-gray-900">Install SafeT Command</p>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-gray-700">
              <li>Tap <Share className="inline h-4 w-4 align-text-bottom" /> <b>Share</b> in Safari&apos;s toolbar.</li>
              <li>Choose <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>. The app opens full-screen from your home screen.</li>
            </ol>
            <button onClick={() => setIosHint(false)} className="w-full rounded-md bg-blue-700 py-2 font-semibold text-white">Got it</button>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
