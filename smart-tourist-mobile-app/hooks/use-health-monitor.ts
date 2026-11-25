import { useSyncExternalStore } from 'react';
import { healthMonitor, MonitorState } from '../services/healthMonitor';

export function useHealthMonitor(): MonitorState {
  return useSyncExternalStore(healthMonitor.subscribe, healthMonitor.getState, healthMonitor.getState);
}
