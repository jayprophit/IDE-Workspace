import { useMemo, useState } from 'react';
import type { AvatarPreset, AvatarPresentation } from '../types';
import { filterByArchetype, filterByPresentation, MAIN_AVATARS, PRESENTATION_LABEL, PRESENTATIONS, SPECIALIST_AVATARS } from '../avatars';
import { AvatarChip } from './AvatarStage';

/**
 * AvatarPicker - the main-avatar chooser.
 *
 * Female, male and neutral are presented as one equal row of filters. There is
 * no default-sex assumption anywhere in this component: the initial selection
 * is passed in by the caller, and every presentation is reachable in one click.
 */

export interface AvatarPickerProps {
  selectedId: string;
  onSelect: (preset: AvatarPreset) => void;
  presets?: AvatarPreset[];
  /** Include the archetype filter row (main / specialist / all). */
  showArchetypeFilter?: boolean;
}

type PresentationFilter = AvatarPresentation | 'all';
type ArchetypeFilter = 'all' | 'main' | 'specialist';

export function AvatarPicker({
  selectedId,
  onSelect,
  presets = MAIN_AVATARS,
  showArchetypeFilter = true,
}: AvatarPickerProps) {
  const [presentation, setPresentation] = useState<PresentationFilter>('all');
  const [archetype, setArchetype] = useState<ArchetypeFilter>('all');

  const visible = useMemo(
    () => filterByArchetype(filterByPresentation(presets, presentation), archetype),
    [presets, presentation, archetype],
  );

  return (
    <div className="gx-col" data-testid="avatar-picker">
      <div className="gx-row gx-wrap" role="group" aria-label="Filter avatars by presentation">
        <button
          type="button"
          className="gx-btn gx-btn--sm"
          aria-pressed={presentation === 'all'}
          onClick={() => setPresentation('all')}
        >
          All
        </button>
        {PRESENTATIONS.map((p) => (
          <button
            key={p}
            type="button"
            className="gx-btn gx-btn--sm"
            aria-pressed={presentation === p}
            onClick={() => setPresentation(p)}
            data-testid={`avatar-filter-${p}`}
          >
            {PRESENTATION_LABEL[p]}
          </button>
        ))}

        {showArchetypeFilter && (
          <>
            <span className="gx-sr-only" role="separator">
              archetype
            </span>
            {(['all', 'main', 'specialist'] as ArchetypeFilter[]).map((a) => (
              <button
                key={a}
                type="button"
                className="gx-btn gx-btn--sm gx-btn--ghost"
                aria-pressed={archetype === a}
                onClick={() => setArchetype(a)}
              >
                {a === 'all' ? 'Any role' : a === 'main' ? 'Companions' : 'Specialists'}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="gx-picker" role="listbox" aria-label="Avatar presets">
        {visible.map((preset) => {
          const selected = preset.id === selectedId;
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={selected}
              aria-pressed={selected}
              className="gx-picker__item"
              onClick={() => onSelect(preset)}
              data-testid={`avatar-option-${preset.id}`}
            >
              <AvatarChip preset={preset} size="md" />
              <span className="gx-picker__meta">
                <span className="gx-picker__name">{preset.name}</span>
                <span className="gx-picker__role">
                  {PRESENTATION_LABEL[preset.appearance.presentation]} &middot; {preset.role}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="gx-empty">
          <span className="gx-empty__title">No avatars match this filter</span>
          <span className="gx-empty__note">Clear the presentation or role filter to see the full roster.</span>
        </div>
      )}
    </div>
  );
}

/**
 * SpecialistCard - a summonable specialist.
 *
 * Deliberately shows role, capability tags and an explicit summon control
 * rather than implying the specialist is already present. Whether a summon
 * actually does anything is the host's business; this component only reports
 * the intent upward.
 */
export function SpecialistCard({
  preset,
  onSummon,
  summoned,
  disabled,
}: {
  preset: AvatarPreset;
  onSummon: (preset: AvatarPreset) => void;
  summoned?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="gx-summon__card" data-testid={`specialist-card-${preset.id}`}>
      <AvatarChip preset={preset} size="lg" />
      <div className="gx-summon__meta">
        <strong>{preset.name}</strong>
        <span>
          {PRESENTATION_LABEL[preset.appearance.presentation]} &middot; {preset.role}
        </span>
        <span className="gx-mono">{preset.capabilities.join(' / ')}</span>
      </div>
      <button
        type="button"
        className={`gx-btn gx-btn--sm ${summoned ? 'gx-btn--ghost' : 'gx-btn--primary'}`}
        onClick={() => onSummon(preset)}
        disabled={disabled || summoned}
        data-testid={`summon-${preset.id}`}
      >
        {summoned ? 'Summoned' : 'Summon'}
      </button>
    </div>
  );
}

/** Convenience: every specialist, ready for a summon panel. */
export const SPECIALIST_PRESETS = SPECIALIST_AVATARS;