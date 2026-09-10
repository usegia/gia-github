"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  restoreFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  restoreFocus: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className="sheet-content"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="sheet-heading">
            <div>
              <span className="eyebrow">PUBLIC SOURCE RECORD</span>
              <Dialog.Title>{title}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close public activity">
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sheet-description">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
