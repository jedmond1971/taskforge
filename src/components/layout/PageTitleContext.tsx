"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";

type PageTitleContextValue = {
  title: string | null;
  setTitle: (title: string | null) => void;
};

const PageTitleContext = createContext<PageTitleContextValue>({
  title: null,
  setTitle: () => {},
});

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Clears the previous page's title on route change; the new page's own
    // SetPageTitle (if any) re-sets it in its own effect. This is a context-wide
    // reset driven by navigation, not state derived from this component's own props.
    setTitle(null);
  }, [pathname]);

  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  const { title } = useContext(PageTitleContext);
  return { title };
}

export function useSetPageTitle(title: string | null) {
  const { setTitle } = useContext(PageTitleContext);

  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}

export function SetPageTitle({ title }: { title: string | null }) {
  useSetPageTitle(title);
  return null;
}
