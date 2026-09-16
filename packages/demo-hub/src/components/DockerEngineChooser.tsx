import {
  ENGINE_CHOOSER_TITLE,
  type DockerEngineId,
} from '../utils/dockerEngine';

interface DockerEngineChooserProps {
  onChoose: (engine: DockerEngineId) => void;
  selected?: DockerEngineId | null;
  disabled?: boolean;
}

function engineButtonClass(id: DockerEngineId, selected?: DockerEngineId | null): string {
  return selected === id
    ? 'prereq-open-docker-btn prereq-open-docker-btn--selected'
    : 'prereq-open-docker-btn';
}

export default function DockerEngineChooser({
  onChoose,
  selected = null,
  disabled = false,
}: DockerEngineChooserProps) {
  return (
    <div className="prereq-docker-status prereq-docker-status--warn" data-testid="prereq-engine-choice">
      <p>{ENGINE_CHOOSER_TITLE}</p>
      <div className="prereq-engine-choice-actions">
        <button
          type="button"
          className={engineButtonClass('desktop', selected)}
          data-testid="prereq-choose-desktop"
          aria-pressed={selected === 'desktop'}
          disabled={disabled}
          onClick={() => onChoose('desktop')}
        >
          Use Docker Desktop
        </button>
        <button
          type="button"
          className={engineButtonClass('orbstack', selected)}
          data-testid="prereq-choose-orbstack"
          aria-pressed={selected === 'orbstack'}
          disabled={disabled}
          onClick={() => onChoose('orbstack')}
        >
          Use OrbStack
        </button>
      </div>
    </div>
  );
}
