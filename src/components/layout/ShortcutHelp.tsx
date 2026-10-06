"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useShortcut } from "./use-shortcut";
import { OPEN_SHORTCUTS_EVENT, SCOPE_HELP, SHORTCUTS, SHORTCUT_SCOPES } from "@/lib/shortcuts";

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useShortcut("?", () => setOpen(true));

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Single-key shortcuts are off while you are typing in a field or editor.
        </DialogDescription>
        <div className="space-y-4">
          {SHORTCUT_SCOPES.map((scope) => (
            <section key={scope} aria-labelledby={`shortcut-scope-${scope}`}>
              <h3
                id={`shortcut-scope-${scope}`}
                className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground mb-1"
              >
                {scope} <span className="normal-case tracking-normal">· {SCOPE_HELP[scope]}</span>
              </h3>
              <ul className="divide-y divide-border-soft">
                {SHORTCUTS.filter((s) => s.scope === scope).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm text-foreground">{s.description}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-xs text-muted-foreground">then</span>}
                          <kbd className="min-w-6 text-center px-1.5 py-0.5 rounded border border-border-soft bg-surface-active text-xs font-sans text-foreground">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
