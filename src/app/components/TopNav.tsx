'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/after-sales-api', label: '售后宝接口调用' },
  { href: '/markdown-editor', label: 'Markdown 编辑器' },
] as const;

export default function TopNav() {
  const pathname = usePathname();

  return (
    <header className="appHeader">
      <div className="appHeaderInner">
        <nav className="appNav" aria-label="主导航">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`appLink ${isActive ? 'appLinkActive' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

