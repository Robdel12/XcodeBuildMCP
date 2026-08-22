export type UiDebuggerGuardMode = 'error' | 'warn' | 'off';
export type FilePathRenderStyle = 'tree' | 'list';

export const SIMULATOR_FRONTEND_PREFERENCES = ['auto', 'device-hub', 'simulator'] as const;
export type SimulatorFrontendPreference = (typeof SIMULATOR_FRONTEND_PREFERENCES)[number];

export function isSimulatorFrontendPreference(value: string): value is SimulatorFrontendPreference {
  return SIMULATOR_FRONTEND_PREFERENCES.includes(value as SimulatorFrontendPreference);
}
