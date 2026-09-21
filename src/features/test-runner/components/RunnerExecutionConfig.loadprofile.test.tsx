/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RunnerExecutionConfig from './RunnerExecutionConfig';
import type { ExecutionMode, ErrorPolicy, LoadProfileConfig, ThinkTimeConfig } from '@shared/types';

type OverrideProps = Partial<React.ComponentProps<typeof RunnerExecutionConfig>>;

const defaultLoadProfile: LoadProfileConfig = {
  type: 'sustained',
  durationSec: 60,
  maxConcurrency: 5,
  rampUpSec: 30,
  spikeConcurrency: 10,
  spikeStartSec: 20,
  spikeDurationSec: 10,
};

const defaultThinkTime: ThinkTimeConfig = { mode: 'none' };

function renderConfig(overrides: OverrideProps = {}) {
  const onExecutionModeChange = vi.fn();
  const onConcurrencyChange = vi.fn();
  const onIterationsChange = vi.fn();
  const onTimeoutSecChange = vi.fn();
  const onRetryCountChange = vi.fn();
  const onRetryDelayMsChange = vi.fn();
  const onErrorPolicyChange = vi.fn();
  const onMaxErrorsChange = vi.fn();
  const onMaxErrorRateChange = vi.fn();
  const onLoadProfileChange = vi.fn();
  const onThinkTimeChange = vi.fn();

  const result = render(
    <RunnerExecutionConfig
      executionMode={'batch' as ExecutionMode}
      onExecutionModeChange={onExecutionModeChange}
      concurrency={4}
      onConcurrencyChange={onConcurrencyChange}
      iterations={20}
      onIterationsChange={onIterationsChange}
      timeoutSec={30}
      onTimeoutSecChange={onTimeoutSecChange}
      retryCount={0}
      onRetryCountChange={onRetryCountChange}
      retryDelayMs={500}
      onRetryDelayMsChange={onRetryDelayMsChange}
      errorPolicy={'continue' as ErrorPolicy}
      onErrorPolicyChange={onErrorPolicyChange}
      maxErrors={5}
      onMaxErrorsChange={onMaxErrorsChange}
      maxErrorRate={10}
      onMaxErrorRateChange={onMaxErrorRateChange}
      loadProfile={defaultLoadProfile}
      onLoadProfileChange={onLoadProfileChange}
      thinkTime={defaultThinkTime}
      onThinkTimeChange={onThinkTimeChange}
      activeTestCount={3}
      isRunning={false}
      {...overrides}
    />,
  );

  return {
    ...result,
    onLoadProfileChange,
  };
}

describe('RunnerExecutionConfig - Load Profile', () => {
  // --- Load profile onChange ---
  it('fires onLoadProfileChange for profile type', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({ executionMode: 'load-profile', onLoadProfileChange } as unknown as OverrideProps);
    fireEvent.click(screen.getByText('Ramp-Up'));
    expect(onLoadProfileChange).toHaveBeenCalledWith({ type: 'ramp-up' });
  });

  it('fires onLoadProfileChange for duration', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({ executionMode: 'load-profile', onLoadProfileChange } as unknown as OverrideProps);
    const input = screen.getByText('Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '120' } });
    expect(onLoadProfileChange).toHaveBeenCalledWith({ durationSec: 120 });
  });

  it('fires onLoadProfileChange for max concurrency', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({ executionMode: 'load-profile', onLoadProfileChange } as unknown as OverrideProps);
    const input = screen.getByText('Max Concurrency').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    expect(onLoadProfileChange).toHaveBeenCalledWith({ maxConcurrency: 20 });
  });

  it('clamps duration on blur', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, durationSec: 2 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ durationSec: 5 });
  });

  it('clamps duration on blur to 5 when stored duration is 0', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, durationSec: 0 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ durationSec: 5 });
  });

  it('clamps max concurrency on blur', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, maxConcurrency: 200 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Max Concurrency').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ maxConcurrency: 100 });
  });

  it('clamps max concurrency on blur to 1 when stored value is 0', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, maxConcurrency: 0 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Max Concurrency').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ maxConcurrency: 1 });
  });

  it('fires onLoadProfileChange for ramp-up sec', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'ramp-up' },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Ramp (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    expect(onLoadProfileChange).toHaveBeenCalledWith({ rampUpSec: 10 });
  });

  it('fires onLoadProfileChange for spike concurrency', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'spike' },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Spike Concurrency').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    expect(onLoadProfileChange).toHaveBeenCalledWith({ spikeConcurrency: 50 });
  });

  it('fires onLoadProfileChange for spike start sec', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'spike' },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Spike Start (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '15' } });
    expect(onLoadProfileChange).toHaveBeenCalledWith({ spikeStartSec: 15 });
  });

  it('fires onLoadProfileChange for spike duration sec', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'spike' },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Spike Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '15' } });
    expect(onLoadProfileChange).toHaveBeenCalledWith({ spikeDurationSec: 15 });
  });

  // onBlur clamps for spike fields
  it('clamps spike concurrency on blur', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'spike', spikeConcurrency: 600 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Spike Concurrency').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ spikeConcurrency: 500 });
  });

  it('clamps ramp sec on blur', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'ramp-up', rampUpSec: 0 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Ramp (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ rampUpSec: 1 });
  });

  // --- Clamp spike start and spike duration on blur ---
  it('clamps spike start on blur', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'spike', spikeStartSec: 999 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Spike Start (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ spikeStartSec: 60 });
  });

  it('clamps spike duration on blur', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'spike', spikeDurationSec: 999 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Spike Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ spikeDurationSec: 60 });
  });

  it('caps ramp-up sec on blur to duration when ramp exceeds duration', () => {
    const onLoadProfileChange = vi.fn();
    renderConfig({
      executionMode: 'load-profile',
      loadProfile: { ...defaultLoadProfile, type: 'ramp-up', durationSec: 20, rampUpSec: 100 },
      onLoadProfileChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Ramp (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onLoadProfileChange).toHaveBeenCalledWith({ rampUpSec: 20 });
  });

  // --- Constant Arrival Rate ---
  it('shows arrival rate config section when constant-arrival mode is active', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 50, durationSec: 60 },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    expect(screen.getByText('Target RPS')).toBeTruthy();
    expect(screen.getByText('Duration (sec)')).toBeTruthy();
    expect(screen.getByText('Max In-Flight')).toBeTruthy();
    expect(screen.getByText('Enable Ramp')).toBeTruthy();
  });

  it('fires onArrivalRateChange for target RPS', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30 },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Target RPS').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({ targetRps: 100 });
  });

  it('fires onArrivalRateChange for duration', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30 },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '120' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({ durationSec: 120 });
  });

  it('shows default maxInFlight hint when not explicitly set', () => {
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30 },
      onArrivalRateChange: vi.fn(),
    } as unknown as OverrideProps);
    expect(screen.getByText('Default: RPS × 10')).toBeTruthy();
  });

  it('toggles ramp sub-section', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30 },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    expect(screen.queryByText('Start RPS')).toBeNull();
    fireEvent.click(screen.getByLabelText('Enable Ramp'));
    expect(onArrivalRateChange).toHaveBeenCalledWith(expect.objectContaining({
      ramp: expect.objectContaining({ startRps: expect.any(Number), endRps: 10, rampDurationSec: 10 }),
    }));
  });

  it('shows ramp fields when ramp is enabled', () => {
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 100, durationSec: 60, ramp: { startRps: 10, endRps: 100, rampDurationSec: 15 } },
      onArrivalRateChange: vi.fn(),
    } as unknown as OverrideProps);
    expect(screen.getByText('Start RPS')).toBeTruthy();
    expect(screen.getByText('End RPS')).toBeTruthy();
    expect(screen.getByText('Ramp Duration (sec)')).toBeTruthy();
  });

  it('keeps Enable Ramp on its own row so labels do not overlap ramp fields', () => {
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 100, durationSec: 60, ramp: { startRps: 10, endRps: 100, rampDurationSec: 15 } },
      onArrivalRateChange: vi.fn(),
    } as unknown as OverrideProps);
    const rampFields = screen.getByTestId('har-arrival-ramp-fields');
    expect(rampFields.contains(screen.getByLabelText('Enable Ramp'))).toBe(false);
    expect(rampFields.querySelectorAll('.profile-field')).toHaveLength(3);
    expect(screen.getByLabelText('Enable Ramp').closest('.arrival-ramp-toggle')).toBeTruthy();
  });

  it('does not show arrival config when arrivalRate prop is missing', () => {
    renderConfig({ executionMode: 'constant-arrival' } as unknown as OverrideProps);
    expect(screen.queryByText('Target RPS')).toBeNull();
  });

  it('fires onArrivalRateChange with float RPS value', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30 },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Target RPS').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.5' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({ targetRps: 0.5 });
  });

  it('fires onArrivalRateChange for maxInFlight', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30, maxInFlight: 100 },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Max In-Flight').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({ maxInFlight: 25 });
  });

  it('fires onArrivalRateChange with ramp undefined when disabling ramp', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 10, durationSec: 30, ramp: { startRps: 1, endRps: 10, rampDurationSec: 10 } },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    fireEvent.click(screen.getByLabelText('Enable Ramp'));
    expect(onArrivalRateChange).toHaveBeenCalledWith({ ramp: undefined });
  });

  it('fires onArrivalRateChange for ramp start RPS', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 100, durationSec: 60, ramp: { startRps: 10, endRps: 100, rampDurationSec: 15 } },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Start RPS').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({
      ramp: { startRps: 20, endRps: 100, rampDurationSec: 15 },
    });
  });

  it('fires onArrivalRateChange for ramp end RPS', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 100, durationSec: 60, ramp: { startRps: 10, endRps: 100, rampDurationSec: 15 } },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('End RPS').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '80' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({
      ramp: { startRps: 10, endRps: 80, rampDurationSec: 15 },
    });
  });

  it('fires onArrivalRateChange for ramp duration', () => {
    const onArrivalRateChange = vi.fn();
    renderConfig({
      executionMode: 'constant-arrival',
      arrivalRate: { targetRps: 100, durationSec: 60, ramp: { startRps: 10, endRps: 100, rampDurationSec: 15 } },
      onArrivalRateChange,
    } as unknown as OverrideProps);
    const input = screen.getByText('Ramp Duration (sec)').closest('.profile-field')?.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    expect(onArrivalRateChange).toHaveBeenCalledWith({
      ramp: { startRps: 10, endRps: 100, rampDurationSec: 20 },
    });
  });
});
