/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { SelectHTMLAttributes } from 'react';
import { KafkaClusterEditor, type KafkaClusterEditorProps } from './KafkaClusterEditor';
import { defaultClusterDraft, type KafkaClusterDraftErrors } from './kafkaClusterForm';

type MockCustomSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
};

vi.mock('../../shared/components/CustomSelect', () => ({
  CustomSelect: ({ value, onChange, options, ...rest }: MockCustomSelectProps) => (
    <select
      data-testid="mock-custom-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      {options.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
}));

function makeProps(overrides: Partial<KafkaClusterEditorProps> = {}): KafkaClusterEditorProps {
  const draft = defaultClusterDraft(123);
  const draftErrors: KafkaClusterDraftErrors = {};
  return {
    loaded: true,
    editorMode: 'create',
    draft,
    draftErrors,
    editingClusterId: null,
    pendingDeleteClusterId: null,
    isCreateClusterIdCustomized: false,
    setPendingDeleteClusterId: vi.fn(),
    setIsCreateClusterIdCustomized: vi.fn(),
    cancelEditor: vi.fn(),
    saveDraft: vi.fn(),
    updateDraft: vi.fn(),
    updateBroker: vi.fn(),
    addBrokerRow: vi.fn(),
    removeBrokerRow: vi.fn(),
    confirmDelete: vi.fn(),
    ...overrides,
  };
}

describe('KafkaClusterEditor', () => {
  it('shows loading text when not loaded', () => {
    render(<KafkaClusterEditor {...makeProps({ loaded: false })} />);
    expect(screen.getByText('Loading cluster configuration...')).toBeTruthy();
  });

  it('shows placeholder when editor mode is null', () => {
    render(<KafkaClusterEditor {...makeProps({ editorMode: null })} />);
    expect(screen.getByText(/Select a saved cluster and click Edit/)).toBeTruthy();
  });

  it('auto-generates cluster id from name in create mode when id is not customized', () => {
    const updateDraft = vi.fn();
    render(<KafkaClusterEditor {...makeProps({ updateDraft, editorMode: 'create', isCreateClusterIdCustomized: false })} />);

    fireEvent.change(screen.getByLabelText('Cluster Name'), { target: { value: 'My Cluster Name' } });

    expect(updateDraft).toHaveBeenCalledWith({
      name: 'My Cluster Name',
      clusterId: 'my-cluster-name',
    });
  });

  it('keeps cluster id unchanged in create mode when id is customized', () => {
    const updateDraft = vi.fn();
    const props = makeProps({ updateDraft, editorMode: 'create', isCreateClusterIdCustomized: true });
    render(<KafkaClusterEditor {...props} />);

    fireEvent.change(screen.getByLabelText('Cluster Name'), { target: { value: 'Renamed Cluster' } });

    expect(updateDraft).toHaveBeenCalledWith({
      name: 'Renamed Cluster',
      clusterId: props.draft.clusterId,
    });
  });

  it('marks cluster id as customized and trims input in create mode', () => {
    const setIsCreateClusterIdCustomized = vi.fn();
    const updateDraft = vi.fn();
    render(
      <KafkaClusterEditor
        {...makeProps({ setIsCreateClusterIdCustomized, updateDraft, editorMode: 'create' })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Cluster ID'), { target: { value: '  custom-id  ' } });

    expect(setIsCreateClusterIdCustomized).toHaveBeenCalledWith(true);
    expect(updateDraft).toHaveBeenCalledWith({ clusterId: 'custom-id' });
  });

  it('renders auth fields for non-none mode and toggles password visibility', () => {
    const updateDraft = vi.fn();
    render(
      <KafkaClusterEditor
        {...makeProps({
          draft: { ...defaultClusterDraft(1), authMode: 'plain', authUsername: 'u', authPassword: 'p' },
          updateDraft,
        })}
      />,
    );

    expect(screen.getByLabelText('Username')).toBeTruthy();
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'next-user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'next-pass' } });
    expect(updateDraft).toHaveBeenCalledWith({ authUsername: 'next-user' });
    expect(updateDraft).toHaveBeenCalledWith({ authPassword: 'next-pass' });
  });

  it('selecting Azure OAUTHBEARER turns TLS on and hides credentials', () => {
    const updateDraft = vi.fn();
    const { rerender } = render(
      <KafkaClusterEditor {...makeProps({ updateDraft })} />,
    );

    fireEvent.change(screen.getByLabelText('Mechanism'), { target: { value: 'oauthbearer' } });
    expect(updateDraft).toHaveBeenCalledWith({ authMode: 'oauthbearer', tlsEnabled: true });

    rerender(
      <KafkaClusterEditor
        {...makeProps({
          updateDraft,
          draft: {
            ...defaultClusterDraft(1),
            authMode: 'oauthbearer',
            tlsEnabled: true,
            brokers: ['a218876-t01-musea2-evhns.servicebus.windows.net:9093'],
          },
        })}
      />,
    );
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.getByText(/Install the Azure CLI/)).toBeTruthy();
  });

  it('toggles TLS controls and passphrase visibility', () => {
    const updateDraft = vi.fn();
    const draft = {
      ...defaultClusterDraft(2),
      tlsEnabled: true,
      tlsRejectUnauthorized: true,
      tlsPassphrase: 'secret',
    };
    render(<KafkaClusterEditor {...makeProps({ draft, updateDraft })} />);

    fireEvent.click(screen.getByTestId('kafka-tls-toggle'));
    fireEvent.click(screen.getByTestId('kafka-tls-verify-toggle'));
    expect(updateDraft).toHaveBeenCalledWith({ tlsEnabled: false });
    expect(updateDraft).toHaveBeenCalledWith({ tlsRejectUnauthorized: false });

    const passphrase = screen.getByLabelText('Key Passphrase') as HTMLInputElement;
    expect(passphrase.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));
    expect((screen.getByLabelText('Key Passphrase') as HTMLInputElement).type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide passphrase' }));
    expect((screen.getByLabelText('Key Passphrase') as HTMLInputElement).type).toBe('password');
  });

  it('disables remove broker when only one broker exists and can add broker', () => {
    const addBrokerRow = vi.fn();
    const removeBrokerRow = vi.fn();
    render(
      <KafkaClusterEditor
        {...makeProps({
          draft: { ...defaultClusterDraft(3), brokers: ['127.0.0.1:19092'] },
          addBrokerRow,
          removeBrokerRow,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Broker' }));
    expect(addBrokerRow).toHaveBeenCalled();
    const removeBtn = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
  });

  it('supports delete flow in edit mode', () => {
    const setPendingDeleteClusterId = vi.fn();
    const confirmDelete = vi.fn();
    const { rerender } = render(
      <KafkaClusterEditor
        {...makeProps({
          editorMode: 'edit',
          editingClusterId: 'cluster-1',
          setPendingDeleteClusterId,
          confirmDelete,
          pendingDeleteClusterId: null,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('kafka-delete-cluster-btn'));
    expect(setPendingDeleteClusterId).toHaveBeenCalledWith('cluster-1');

    rerender(
      <KafkaClusterEditor
        {...makeProps({
          editorMode: 'edit',
          editingClusterId: 'cluster-1',
          setPendingDeleteClusterId,
          confirmDelete,
          pendingDeleteClusterId: 'cluster-1',
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('kafka-confirm-delete-btn'));
    expect(confirmDelete).toHaveBeenCalled();
    const confirmPanel = screen.getByTestId('kafka-delete-confirm');
    fireEvent.click(within(confirmPanel).getByRole('button', { name: 'Cancel' }));
    expect(setPendingDeleteClusterId).toHaveBeenCalledWith(null);
  });
});
