// Keep Awake Utility - Prevent browser throttling when tab is in background
// Uses Wake Lock API + Silent Audio fallback for maximum compatibility

import { logger } from './logger';

export class KeepAwake {
  private wakeLock: WakeLockSentinel | null = null;
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private isActive = false;

  /**
   * Start keeping the tab awake
   * Tries Wake Lock API first, falls back to silent audio if not supported
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('KeepAwake', 'Already active');
      return;
    }

    logger.info('KeepAwake', 'Starting keep-awake mode...');

    // Try Wake Lock API first (Chrome/Edge desktop)
    const wakeLockSuccess = await this.tryWakeLock();

    // Try silent audio as fallback (all browsers)
    const audioSuccess = this.tryAudio();

    if (wakeLockSuccess || audioSuccess) {
      this.isActive = true;
      logger.info('KeepAwake', 'Keep-awake mode activated', {
        wakeLock: wakeLockSuccess,
        audio: audioSuccess
      });
    } else {
      logger.error('KeepAwake', 'Failed to activate keep-awake mode');
      throw new Error('Keep-awake not supported in this browser');
    }
  }

  /**
   * Stop keeping the tab awake
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      logger.warn('KeepAwake', 'Not active');
      return;
    }

    logger.info('KeepAwake', 'Stopping keep-awake mode...');

    // Release Wake Lock
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        logger.info('KeepAwake', 'Wake Lock released');
      } catch (error) {
        logger.error('KeepAwake', 'Failed to release Wake Lock', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Stop audio
    if (this.oscillator && this.audioContext) {
      try {
        this.oscillator.stop();
        this.oscillator.disconnect();
        this.gainNode?.disconnect();
        await this.audioContext.close();
        this.oscillator = null;
        this.gainNode = null;
        this.audioContext = null;
        logger.info('KeepAwake', 'Audio stopped');
      } catch (error) {
        logger.error('KeepAwake', 'Failed to stop audio', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.isActive = false;
    logger.info('KeepAwake', 'Keep-awake mode deactivated');
  }

  /**
   * Check if keep-awake is currently active
   */
  isEnabled(): boolean {
    return this.isActive;
  }

  /**
   * Try to acquire Wake Lock (Chrome/Edge desktop only)
   */
  private async tryWakeLock(): Promise<boolean> {
    try {
      // Check if Wake Lock API is supported
      if (!('wakeLock' in navigator)) {
        logger.warn('KeepAwake', 'Wake Lock API not supported');
        return false;
      }

      // Request screen wake lock
      this.wakeLock = await navigator.wakeLock.request('screen');

      // Re-acquire wake lock if page becomes visible again
      this.wakeLock.addEventListener('release', () => {
        logger.info('KeepAwake', 'Wake Lock released by system');
        if (this.isActive) {
          logger.info('KeepAwake', 'Attempting to re-acquire Wake Lock...');
          this.tryWakeLock();
        }
      });

      logger.info('KeepAwake', 'Wake Lock acquired successfully');
      return true;
    } catch (error) {
      logger.warn('KeepAwake', 'Wake Lock failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Play silent audio to prevent throttling (fallback for all browsers)
   */
  private tryAudio(): boolean {
    try {
      // Create audio context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        logger.warn('KeepAwake', 'AudioContext not supported');
        return false;
      }

      this.audioContext = new AudioContextClass();

      // Create oscillator (generates tone)
      this.oscillator = this.audioContext.createOscillator();
      this.oscillator.frequency.value = 1; // Very low frequency (inaudible)

      // Create gain node (volume control)
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.001; // Almost silent (but not zero)

      // Connect: oscillator -> gain -> output
      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Start playing
      this.oscillator.start();

      logger.info('KeepAwake', 'Silent audio started');
      return true;
    } catch (error) {
      logger.warn('KeepAwake', 'Silent audio failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

export default KeepAwake;
