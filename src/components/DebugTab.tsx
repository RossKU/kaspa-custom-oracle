import { logger } from '../utils/logger';

interface DebugTabProps {
  debugLogs: string[];
}

export function DebugTab({ debugLogs }: DebugTabProps) {
  return (
    <section className="tab-content debug-tab">
      <div className="debug-header">
        <h2>🐛 Debug Logs ({debugLogs.length})</h2>
        <div className="debug-controls">
          <button onClick={() => logger.downloadLogs()} className="btn btn-primary">
            📥 Download Logs
          </button>
          <button onClick={() => logger.clear()} className="btn btn-secondary">
            🗑️ Clear Logs
          </button>
        </div>
      </div>
      <div className="debug-logs">
        {debugLogs.length === 0 ? (
          <div className="debug-empty">No logs yet...</div>
        ) : (
          debugLogs.map((log, idx) => (
            <div key={idx} className="debug-log-entry">
              {log}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
