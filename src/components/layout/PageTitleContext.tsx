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
