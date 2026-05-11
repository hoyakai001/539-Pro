import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SyncLogRow } from '../types';
import { SyncLogTable } from './SyncLogTable';

export const SyncLogPanel: React.FC = () => {
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  useEffect(() => {
    api.getSyncLogs(20).then(res => setLogs(res.data)).catch(() => {});
  }, []);
  return <SyncLogTable logs={logs} />;
};
