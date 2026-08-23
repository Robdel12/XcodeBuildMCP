import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildOpenAppCommand,
  buildOpenSimulatorFrontendCommands,
  buildOpenSimulatorAppCommand,
  isHeadlessLaunchMode,
  openSimulatorFrontend,
} from '../focus-policy.ts';
import { __resetConfigStoreForTests, initConfigStore } from '../config-store.ts';
import {
  createMockCommandResponse,
  createMockFileSystemExecutor,
} from '../../test-utils/mock-executors.ts';

const ENV_VAR = 'XCODEBUILDMCP_HEADLESS_LAUNCH';
const FRONTEND_ENV_VAR = 'XCODEBUILDMCP_SIMULATOR_FRONTEND';
const CONFIG_PATH = '/repo/.xcodebuildmcp/config.yaml';

describe('focus-policy', () => {
  let previousHeadless: string | undefined;
  let previousFrontend: string | undefined;

  async function initFrontendConfig(frontend: 'device-hub' | 'simulator'): Promise<void> {
    await initConfigStore({
      cwd: '/repo',
      fs: createMockFileSystemExecutor({
        existsSync: (targetPath) => targetPath === CONFIG_PATH,
        readFile: async (targetPath) => {
          if (targetPath !== CONFIG_PATH) {
            throw new Error(`Unexpected readFile path: ${targetPath}`);
          }
          return `schemaVersion: 1\nsimulatorFrontend: ${frontend}\n`;
        },
      }),
    });
  }

  beforeEach(() => {
    previousHeadless = process.env[ENV_VAR];
    previousFrontend = process.env[FRONTEND_ENV_VAR];
    delete process.env[ENV_VAR];
    delete process.env[FRONTEND_ENV_VAR];
    __resetConfigStoreForTests();
  });

  afterEach(() => {
    if (previousHeadless === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previousHeadless;
    }
    if (previousFrontend === undefined) {
      delete process.env[FRONTEND_ENV_VAR];
    } else {
      process.env[FRONTEND_ENV_VAR] = previousFrontend;
    }
    __resetConfigStoreForTests();
  });

  describe('isHeadlessLaunchMode', () => {
    it('returns false when unset', () => {
      expect(isHeadlessLaunchMode()).toBe(false);
    });

    it('returns true for "1"', () => {
      process.env[ENV_VAR] = '1';
      expect(isHeadlessLaunchMode()).toBe(true);
    });

    it('returns true for "true" case-insensitive', () => {
      process.env[ENV_VAR] = 'TRUE';
      expect(isHeadlessLaunchMode()).toBe(true);
    });

    it('returns false for "0"', () => {
      process.env[ENV_VAR] = '0';
      expect(isHeadlessLaunchMode()).toBe(false);
    });

    it('returns false for empty string', () => {
      process.env[ENV_VAR] = '';
      expect(isHeadlessLaunchMode()).toBe(false);
    });
  });

  describe('buildOpenAppCommand', () => {
    it('returns plain `open <path>` by default', () => {
      expect(buildOpenAppCommand('/Apps/Foo.app')).toEqual(['open', '/Apps/Foo.app']);
    });

    it('appends --args when args are provided', () => {
      expect(buildOpenAppCommand('/Apps/Foo.app', { args: ['--flag', 'value'] })).toEqual([
        'open',
        '/Apps/Foo.app',
        '--args',
        '--flag',
        'value',
      ]);
    });

    it('inserts -g when headless mode is enabled', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenAppCommand('/Apps/Foo.app')).toEqual(['open', '-g', '/Apps/Foo.app']);
    });

    it('preserves --args ordering under headless mode', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenAppCommand('/Apps/Foo.app', { args: ['x'] })).toEqual([
        'open',
        '-g',
        '/Apps/Foo.app',
        '--args',
        'x',
      ]);
    });
  });

  describe('buildOpenSimulatorAppCommand', () => {
    it('returns `open -a Simulator` by default', () => {
      expect(buildOpenSimulatorAppCommand()).toEqual(['open', '-a', 'Simulator']);
    });

    it('targets a simulator UDID when provided', () => {
      expect(buildOpenSimulatorAppCommand({ simulatorId: 'SIM-123' })).toEqual([
        'open',
        '-a',
        'Simulator',
        '--args',
        '-CurrentDeviceUDID',
        'SIM-123',
      ]);
    });

    it('returns null in headless mode', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenSimulatorAppCommand()).toBeNull();
    });

    it('adds -g when background mode is enabled', async () => {
      await initConfigStore({
        cwd: '/repo',
        fs: createMockFileSystemExecutor({ existsSync: () => false }),
        env: { XCODEBUILDMCP_SIMULATOR_FRONTEND_BACKGROUND: 'true' },
      });

      expect(buildOpenSimulatorAppCommand()).toEqual(['open', '-g', '-a', 'Simulator']);
    });
  });

  describe('buildOpenSimulatorFrontendCommands', () => {
    it('uses Device Hub first and Simulator.app as the auto fallback', () => {
      expect(buildOpenSimulatorFrontendCommands()).toEqual([
        { frontend: 'device-hub', command: ['open', '-a', 'DeviceHub'] },
        { frontend: 'simulator', command: ['open', '-a', 'Simulator'] },
      ]);
    });

    it('targets the requested UDID in both frontends', () => {
      expect(buildOpenSimulatorFrontendCommands({ simulatorId: 'SIM 123' })).toEqual([
        {
          frontend: 'device-hub',
          command: ['open', 'devices:///manage/select?id=SIM%20123'],
        },
        {
          frontend: 'simulator',
          command: ['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', 'SIM 123'],
        },
      ]);
    });

    it('selects only Simulator.app when configured', async () => {
      await initFrontendConfig('simulator');

      expect(buildOpenSimulatorFrontendCommands({ simulatorId: 'SIM 123' })).toEqual([
        {
          frontend: 'simulator',
          command: ['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', 'SIM 123'],
        },
      ]);
    });

    it('selects only Device Hub when configured', async () => {
      await initFrontendConfig('device-hub');

      expect(buildOpenSimulatorFrontendCommands({ simulatorId: 'SIM 123' })).toEqual([
        {
          frontend: 'device-hub',
          command: ['open', 'devices:///manage/select?id=SIM%20123'],
        },
      ]);
    });

    it('returns null in headless mode', () => {
      process.env[ENV_VAR] = '1';
      expect(buildOpenSimulatorFrontendCommands()).toBeNull();
    });
  });

  describe('openSimulatorFrontend', () => {
    it('uses Device Hub when it is available', async () => {
      const commands: string[][] = [];
      const result = await openSimulatorFrontend(async (command) => {
        commands.push(command);
        return createMockCommandResponse({ success: true });
      });

      expect(result).toEqual({ success: true, frontend: 'device-hub' });
      expect(commands).toEqual([['open', '-a', 'DeviceHub']]);
    });

    it('falls back to Simulator.app when Device Hub is unavailable', async () => {
      const commands: string[][] = [];
      const result = await openSimulatorFrontend(async (command) => {
        commands.push(command);
        return createMockCommandResponse({
          success: command.includes('Simulator'),
          error: command.includes('Simulator') ? undefined : 'Device Hub not found',
        });
      });

      expect(result).toEqual({ success: true, frontend: 'simulator' });
      expect(commands).toEqual([
        ['open', '-a', 'DeviceHub'],
        ['open', '-a', 'Simulator'],
      ]);
    });

    it.each([
      {
        frontend: 'simulator' as const,
        command: ['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', 'SIM 123'],
      },
      {
        frontend: 'device-hub' as const,
        command: ['open', 'devices:///manage/select?id=SIM%20123'],
      },
    ])('uses the project YAML preference for $frontend', async ({ frontend, command }) => {
      await initFrontendConfig(frontend);

      const commands: string[][] = [];
      const result = await openSimulatorFrontend(
        async (command) => {
          commands.push(command);
          return createMockCommandResponse({ success: true });
        },
        { simulatorId: 'SIM 123' },
      );

      expect(result).toEqual({ success: true, frontend });
      expect(commands).toEqual([command]);
    });

    it('reports both launch failures', async () => {
      const errors = ['DeviceHub not found', 'Simulator not found'];
      let errorIndex = 0;
      const result = await openSimulatorFrontend(async () =>
        createMockCommandResponse({ success: false, error: errors[errorIndex++] }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Device Hub: DeviceHub not found');
        expect(result.error).toContain('Simulator.app: Simulator not found');
      }
    });

    it.each([
      { frontend: 'device-hub' as const, command: ['open', '-a', 'DeviceHub'] },
      { frontend: 'simulator' as const, command: ['open', '-a', 'Simulator'] },
    ])(
      'does not fall back when $frontend is configured and unavailable',
      async ({ frontend, command }) => {
        await initFrontendConfig(frontend);
        const commands: string[][] = [];
        const result = await openSimulatorFrontend(async (command) => {
          commands.push(command);
          return createMockCommandResponse({ success: false, error: 'not found' });
        });

        expect(result.success).toBe(false);
        expect(commands).toEqual([command]);
      },
    );

    it('skips both frontends in headless mode', async () => {
      process.env[ENV_VAR] = '1';
      let called = false;
      const result = await openSimulatorFrontend(async () => {
        called = true;
        return createMockCommandResponse({ success: true });
      });

      expect(result).toEqual({ success: true, frontend: null });
      expect(called).toBe(false);
    });
  });
});
