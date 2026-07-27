import { useEffect, useState } from 'react';

type LocalReadReceipts = Record<string, number>;

const STORAGE_KEY = 'meraki:inbox:readReceipts:v1';

function loadReceipts(): LocalReadReceipts {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LocalReadReceipts;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveReceipts(nextReceipts: LocalReadReceipts) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextReceipts));
  } catch {
    // localStorage can be unavailable in private browsing or restricted contexts.
  }
}

let receipts: LocalReadReceipts = loadReceipts();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setLocalLeadRead(leadId: string, readAtMillis: number) {
  if ((receipts[leadId] ?? 0) >= readAtMillis) return;
  receipts = { ...receipts, [leadId]: readAtMillis };
  saveReceipts(receipts);
  emit();
}

export function useLocalReadReceipts(): LocalReadReceipts {
  const [snapshot, setSnapshot] = useState(receipts);

  useEffect(() => {
    const listener = () => setSnapshot(receipts);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return snapshot;
}
