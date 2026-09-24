import React, { useEffect, useRef } from 'react';
import { App } from './App';
import { startSocket, resetForSheet } from './socket';

interface SheetPageProps {
  sheetId: string;
  accountMenu?: React.ReactNode;
}

export function SheetPage({ sheetId, accountMenu }: SheetPageProps) {
  const prevSheetId = useRef<string | null>(null);

  useEffect(() => {
    if (prevSheetId.current === null) {
      // First mount: start socket with this sheetId
      startSocket(sheetId);
    } else if (prevSheetId.current !== sheetId) {
      // Sheet changed: reset and reconnect
      resetForSheet(sheetId);
    }
    prevSheetId.current = sheetId;
  }, [sheetId]);

  return <App accountMenu={accountMenu} />;
}
