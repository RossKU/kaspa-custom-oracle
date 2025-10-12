// Global Debug Logger with UI Display and Download

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  data?: any;
}

class DebugLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 500; // Keep last 500 logs
  private listeners: ((logs: LogEntry[]) => void)[] = [];

  log(source: string, message: string, data?: any, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      data
    };

    this.logs.push(entry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Also log to console
    const consoleMsg = `[${source}] ${message}`;
    switch (level) {
      case 'error':
        console.error(consoleMsg, data || '');
        break;
      case 'warn':
        console.warn(consoleMsg, data || '');
        break;
      case 'debug':
        console.debug(consoleMsg, data || '');
        break;
      default:
        console.log(consoleMsg, data || '');
    }

    // Notify listeners
    this.notifyListeners();
  }

  info(source: string, message: string, data?: any) {
    this.log(source, message, data, 'info');
  }

  warn(source: string, message: string, data?: any) {
    this.log(source, message, data, 'warn');
  }

  error(source: string, message: string, data?: any) {
    this.log(source, message, data, 'error');
  }

  debug(source: string, message: string, data?: any) {
    this.log(source, message, data, 'debug');
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsAsText(): string {
    return this.logs.map(entry => {
      const dataStr = entry.data ? ` | Data: ${JSON.stringify(entry.data)}` : '';
      return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}${dataStr}`;
    }).join('\n');
  }

  downloadLogs() {
    const text = this.getLogsAsText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaspa-oracle-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clear() {
    this.logs = [];
    this.notifyListeners();
  }

  // Subscribe to log updates
  subscribe(listener: (logs: LogEntry[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.logs]));
  }
}

// Global singleton instance
export const logger = new DebugLogger();
