import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface SidebarContextValue {
  hidden: boolean;
  show: () => void;
  hide: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  hidden: false,
  show: () => {},
  hide: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return (
    <SidebarContext.Provider value={{ hidden, show: () => setHidden(false), hide: () => setHidden(true) }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
