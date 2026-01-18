import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createLinuxPlatform } from '../../util/linux.js';
import { createMockShellRunner } from '../setup.js';

describe('Linux Platform Compatibility', () => {
  let originalEnv;
  let mockShell;
  let linux;
  const debugLogs = [];
  const debugLog = (msg) => debugLogs.push(msg);

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear relevant env vars
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.XDG_SESSION_TYPE;
    
    mockShell = createMockShellRunner();
    linux = createLinuxPlatform({ $: mockShell, debugLog });
    debugLogs.length = 0;
  });

  afterEach(() => {
    // Restore env vars
    process.env = originalEnv;
  });

  describe('Session Detection', () => {
    it('isWayland() should detect WAYLAND_DISPLAY', () => {
      expect(linux.isWayland()).toBe(false);
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      expect(linux.isWayland()).toBe(true);
    });

    it('isX11() should detect DISPLAY without Wayland', () => {
      expect(linux.isX11()).toBe(false);
      process.env.DISPLAY = ':0';
      expect(linux.isX11()).toBe(true);
      
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      expect(linux.isX11()).toBe(false); // Wayland takes precedence/invalidates pure X11 detection in this logic
    });

    it('getSessionType() should return correct type from env', () => {
      expect(linux.getSessionType()).toBe('unknown');
      
      process.env.XDG_SESSION_TYPE = 'x11';
      expect(linux.getSessionType()).toBe('x11');
      
      process.env.XDG_SESSION_TYPE = 'wayland';
      expect(linux.getSessionType()).toBe('wayland');
      
      process.env.XDG_SESSION_TYPE = 'tty';
      expect(linux.getSessionType()).toBe('tty');
      
      delete process.env.XDG_SESSION_TYPE;
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      expect(linux.getSessionType()).toBe('wayland');
      
      delete process.env.WAYLAND_DISPLAY;
      process.env.DISPLAY = ':0';
      expect(linux.getSessionType()).toBe('x11');
    });
  });

  describe('Wake Monitor', () => {
    it('wakeMonitorX11() should call xset', async () => {
      const success = await linux.wakeMonitorX11();
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('xset dpms force on')).toBe(true);
    });

    it('wakeMonitorGnomeDBus() should call gdbus', async () => {
      const success = await linux.wakeMonitorGnomeDBus();
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.gnome.SettingsDaemon.Power.Screen.StepUp')).toBe(true);
    });

    it('wakeMonitor() should try X11 then GNOME', async () => {
      // First try X11 succeeds
      mockShell.reset();
      let success = await linux.wakeMonitor();
      expect(success).toBe(true);
      expect(mockShell.getCallCount()).toBe(1);
      expect(mockShell.getLastCall().command).toContain('xset');

      // X11 fails, GNOME succeeds
      mockShell.reset();
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('xset')) throw new Error('xset failed');
          return { exitCode: 0 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      success = await linux.wakeMonitor();
      expect(success).toBe(true);
      expect(mockShell.getCallCount()).toBe(2);
      expect(mockShell.getCalls()[0].command).toContain('xset');
      expect(mockShell.getCalls()[1].command).toContain('gdbus');

      // Both fail
      mockShell.reset();
      mockShell = createMockShellRunner({
        handler: (cmd) => { throw new Error('all failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      success = await linux.wakeMonitor();
      expect(success).toBe(false);
      expect(mockShell.getCallCount()).toBe(2);
    });
  });

  describe('Volume Control - PulseAudio (pactl)', () => {
    it('getVolumePulse() should parse pactl output', async () => {
      mockShell = createMockShellRunner({
        handler: () => ({ stdout: Buffer.from('Volume: front-left: 65536 / 75% / 0.00 dB') })
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      const vol = await linux.pulse.getVolume();
      expect(vol).toBe(75);
    });

    it('setVolumePulse() should call pactl set-sink-volume', async () => {
      const success = await linux.pulse.setVolume(80);
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('pactl set-sink-volume @DEFAULT_SINK@ 80%')).toBe(true);
    });

    it('setVolumePulse() should return false on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('pactl failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.pulse.setVolume(50)).toBe(false);
      expect(debugLogs.some(log => log.includes('setVolume: pactl failed'))).toBe(true);
    });

    it('unmutePulse() should call pactl set-sink-mute 0', async () => {
      const success = await linux.pulse.unmute();
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('pactl set-sink-mute @DEFAULT_SINK@ 0')).toBe(true);
    });

    it('unmutePulse() should return false on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('pactl failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.pulse.unmute()).toBe(false);
      expect(debugLogs.some(log => log.includes('unmute: pactl failed'))).toBe(true);
    });

    it('isMutedPulse() should detect mute status', async () => {
      mockShell = createMockShellRunner({
        handler: () => ({ stdout: Buffer.from('Mute: yes') })
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.pulse.isMuted()).toBe(true);

      mockShell = createMockShellRunner({
        handler: () => ({ stdout: Buffer.from('Mute: no') })
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.pulse.isMuted()).toBe(false);
    });

    it('isMutedPulse() should return null on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('pactl failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.pulse.isMuted()).toBeNull();
      expect(debugLogs.some(log => log.includes('isMuted: pactl failed'))).toBe(true);
    });
  });

  describe('Volume Control - ALSA (amixer)', () => {
    it('getVolumeAlsa() should parse amixer output', async () => {
      mockShell = createMockShellRunner({
        handler: () => ({ stdout: Buffer.from('Front Left: Playback 65536 [60%] [on]') })
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      const vol = await linux.alsa.getVolume();
      expect(vol).toBe(60);
    });

    it('getVolumeAlsa() should return -1 on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('amixer failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.alsa.getVolume()).toBe(-1);
      expect(debugLogs.some(log => log.includes('getVolume: amixer failed'))).toBe(true);
    });

    it('setVolumeAlsa() should call amixer set Master', async () => {
      const success = await linux.alsa.setVolume(45);
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('amixer set Master 45%')).toBe(true);
    });

    it('setVolumeAlsa() should return false on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('amixer failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.alsa.setVolume(50)).toBe(false);
      expect(debugLogs.some(log => log.includes('setVolume: amixer failed'))).toBe(true);
    });

    it('unmuteAlsa() should call amixer set Master unmute', async () => {
      const success = await linux.alsa.unmute();
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('amixer set Master unmute')).toBe(true);
    });

    it('unmuteAlsa() should return false on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('amixer failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.alsa.unmute()).toBe(false);
      expect(debugLogs.some(log => log.includes('unmute: amixer failed'))).toBe(true);
    });

    it('isMutedAlsa() should detect mute status', async () => {
      mockShell = createMockShellRunner({
        handler: () => ({ stdout: Buffer.from('[off]') })
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.alsa.isMuted()).toBe(true);

      mockShell = createMockShellRunner({
        handler: () => ({ stdout: Buffer.from('[on]') })
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.alsa.isMuted()).toBe(false);
    });

    it('isMutedAlsa() should return null on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('amixer failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.alsa.isMuted()).toBeNull();
      expect(debugLogs.some(log => log.includes('isMuted: amixer failed'))).toBe(true);
    });
  });

  describe('Unified Volume Control', () => {
    it('getCurrentVolume() should try Pulse then ALSA', async () => {
      // Pulse succeeds
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('pactl')) return { stdout: Buffer.from('70%') };
          return { exitCode: 1 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.getCurrentVolume()).toBe(70);
      expect(mockShell.getCallCount()).toBe(1);

      // Pulse fails, ALSA succeeds
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('pactl')) throw new Error('fail');
          if (cmd.includes('amixer')) return { stdout: Buffer.from('[50%]') };
          return { exitCode: 1 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.getCurrentVolume()).toBe(50);
      expect(mockShell.getCallCount()).toBe(2);
    });

    it('isMuted() should try Pulse then ALSA', async () => {
      // Pulse succeeds
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('pactl')) return { stdout: Buffer.from('Mute: yes') };
          return { exitCode: 1 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.isMuted()).toBe(true);

      // Pulse fails, ALSA succeeds
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('pactl')) throw new Error('fail');
          if (cmd.includes('amixer')) return { stdout: Buffer.from('[off]') };
          return { exitCode: 1 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.isMuted()).toBe(true);
    });

    it('forceVolume() should unmute and set to 100%', async () => {
      const success = await linux.forceVolume();
      expect(success).toBe(true);
      expect(mockShell.wasCalledWith('100%')).toBe(true);
      // Depending on implementation, it might call Pulse or ALSA
    });

    it('forceVolumeIfNeeded() should check threshold', async () => {
      // Above threshold
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('pactl get')) return { stdout: Buffer.from('80%') };
          return { exitCode: 0 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      let forced = await linux.forceVolumeIfNeeded(50);
      expect(forced).toBe(false);
      expect(mockShell.getCallCount()).toBe(1);

      // Below threshold
      mockShell.reset();
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('pactl get')) return { stdout: Buffer.from('20%') };
          return { exitCode: 0 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      forced = await linux.forceVolumeIfNeeded(50);
      expect(forced).toBe(true);
      expect(mockShell.wasCalledWith('100%')).toBe(true);

      // Detection fails
      mockShell.reset();
      mockShell = createMockShellRunner({
        handler: (cmd) => { 
          if (cmd.includes('get')) throw new Error('fail');
          return { exitCode: 0 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      forced = await linux.forceVolumeIfNeeded(50);
      expect(forced).toBe(true);
      expect(debugLogs.some(log => log.includes('could not detect volume'))).toBe(true);
      expect(mockShell.wasCalledWith('100%')).toBe(true);
    });
  });

  describe('Audio Playback', () => {
    it('playAudioPulse() should return false on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('paplay failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.playAudioPulse('test.mp3')).toBe(false);
      expect(debugLogs.some(log => log.includes('playAudio: paplay failed'))).toBe(true);
    });

    it('playAudioAlsa() should return false on error', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('aplay failed'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      expect(await linux.playAudioAlsa('test.wav')).toBe(false);
      expect(debugLogs.some(log => log.includes('playAudio: aplay failed'))).toBe(true);
    });

    it('playAudioFile() should try paplay then aplay', async () => {
      // paplay succeeds
      mockShell.reset();
      let success = await linux.playAudioFile('test.mp3');
      expect(success).toBe(true);
      expect(mockShell.getCallCount()).toBe(1);
      expect(mockShell.getLastCall().command).toContain('paplay');

      // paplay fails, aplay succeeds
      mockShell.reset();
      mockShell = createMockShellRunner({
        handler: (cmd) => {
          if (cmd.includes('paplay')) throw new Error('fail');
          return { exitCode: 0 };
        }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      success = await linux.playAudioFile('test.wav');
      expect(success).toBe(true);
      expect(mockShell.getCallCount()).toBe(2);
      expect(mockShell.getCalls()[0].command).toContain('paplay');
      expect(mockShell.getCalls()[1].command).toContain('aplay');
    });

    it('playAudioFile() should return false if all fail', async () => {
      mockShell = createMockShellRunner({
        handler: () => { throw new Error('fail'); }
      });
      linux = createLinuxPlatform({ $: mockShell, debugLog });
      const success = await linux.playAudioFile('test.mp3');
      expect(success).toBe(false);
      expect(debugLogs.some(log => log.includes('all methods failed'))).toBe(true);
    });

    it('playAudioFile() should respect loops', async () => {
      mockShell.reset();
      await linux.playAudioFile('test.mp3', 3);
      expect(mockShell.getCallCount()).toBe(3);
    });
  });
});
