'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { LeadCardField, LeadCardId } from '@/lib/features/leads/detail-fields';
import { useTranslations } from 'next-intl';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface EditSessionValue {
  /** The card being edited (one at a time) */
  editing: LeadCardId | null;
  /** The field to focus when the card opened (else its first field) */
  focusField: LeadCardField | null;
  /** Whether the open card has unsaved changes */
  dirty: boolean;
  /** Open a card for editing; asks first when another card has unsaved changes */
  open: (card: LeadCardId, field?: LeadCardField | null) => Promise<boolean>;
  /** Close the open card (after saving or cancelling) */
  close: () => void;
  setDirty: (dirty: boolean) => void;
  /** Resolves true when nothing is unsaved, or the user chose to discard it */
  confirmDiscard: () => Promise<boolean>;
}

const EditSessionContext = createContext<EditSessionValue | null>(null);

export function useEditSession(): EditSessionValue {
  const value = useContext(EditSessionContext);
  if (!value) throw new Error('useEditSession must be used within EditSessionProvider');
  return value;
}

interface EditSessionProviderProps {
  children: ReactNode;
  initialCard?: LeadCardId | null;
  initialField?: LeadCardField | null;
}

/**
 * In-place editing on the lead page (Refs #109): one card at a time, and unsaved changes are
 * never dropped silently (another card, a tab, the back link, closing the browser tab).
 */
export function EditSessionProvider({
  children,
  initialCard = null,
  initialField = null,
}: EditSessionProviderProps) {
  const t = useTranslations('leadDetail.edit');
  const [editing, setEditing] = useState<LeadCardId | null>(initialCard);
  const [focusField, setFocusField] = useState<LeadCardField | null>(initialField);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const resolver = useRef<((discard: boolean) => void) | null>(null);

  const answer = useCallback((discard: boolean) => {
    setAsking(false);
    resolver.current?.(discard);
    resolver.current = null;
  }, []);

  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (!dirty) return Promise.resolve(true);
    // A question already open gets "keep editing"
    resolver.current?.(false);
    setAsking(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, [dirty]);

  const open = useCallback(
    async (card: LeadCardId, field: LeadCardField | null = null) => {
      if (editing && editing !== card && !(await confirmDiscard())) return false;
      setDirty(editing === card ? dirty : false);
      setEditing(card);
      setFocusField(field);
      return true;
    },
    [editing, dirty, confirmDiscard]
  );

  const close = useCallback(() => {
    setEditing(null);
    setFocusField(null);
    setDirty(false);
  }, []);

  // Closing or reloading the browser tab with unsaved changes asks the browser's question
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const value = useMemo<EditSessionValue>(
    () => ({ editing, focusField, dirty, open, close, setDirty, confirmDiscard }),
    [editing, focusField, dirty, open, close, confirmDiscard]
  );

  return (
    <EditSessionContext.Provider value={value}>
      {children}
      <AlertDialog
        open={asking}
        onOpenChange={(next) => {
          if (!next) answer(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => answer(false)}>{t('keepEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => answer(true)} className="bg-red-600 hover:bg-red-700">
              {t('discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EditSessionContext.Provider>
  );
}
