import { useState } from "react";
import {
  DEFAULT_SCHOOL_CURRICULUM,
  type CurriculumTopic,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { EntryForm, Field } from "./TrainingFields";

export function CurriculumSettings({
  snapshot,
  pending,
  onSave
}: {
  snapshot: TrainingSnapshot;
  pending: (id: string) => boolean;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  const record = snapshot.curriculum;
  const target = record?.id ?? `curriculum-${snapshot.schoolId}`;
  const [topics, setTopics] = useState<CurriculumTopic[]>(() =>
    structuredClone(record?.data.topics ?? DEFAULT_SCHOOL_CURRICULUM.topics)
  );
  const move = (index: number, direction: -1 | 1) => {
    const next = [...topics];
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    setTopics(next);
  };
  const update = (index: number, patch: Partial<CurriculumTopic>) =>
    setTopics((current) =>
      current.map((topic, topicIndex) => (topicIndex === index ? { ...topic, ...patch } : topic))
    );

  return (
    <details className="dm-panel training-panel training-setting curriculum-settings">
      <summary>Lesson topics instructors can choose</summary>
      <p>
        DriveMaster has added simple starter topics. Change only what your school needs. Hidden
        topics stay in your settings but instructors will not see them.
      </p>
      <EntryForm
        title="Save lesson topics"
        disabled={pending(target)}
        onSave={(form) =>
          onSave(
            "CURRICULUM",
            target,
            {
              topics: topics.map((topic) => ({ ...topic, name: topic.name.trim() })),
              reason: String(form.get("reason") ?? "")
            },
            record?.version
          )
        }
      >
        <div className="curriculum-topic-list">
          {topics.map((topic, index) => (
            <article className="curriculum-topic-row" key={topic.id}>
              <label>
                Topic {index + 1}
                <input
                  value={topic.name}
                  maxLength={100}
                  required
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </label>
              <label className="training-check curriculum-visible">
                <input
                  type="checkbox"
                  checked={topic.active}
                  onChange={(event) => update(index, { active: event.target.checked })}
                />
                Show to instructors
              </label>
              <div className="curriculum-topic-actions" aria-label={`Arrange ${topic.name}`}>
                <button
                  className="dm-secondary"
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${topic.name} up`}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="dm-secondary"
                  type="button"
                  disabled={index === topics.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${topic.name} down`}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="dm-secondary curriculum-remove"
                  type="button"
                  disabled={topics.length === 1}
                  onClick={() => setTopics((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove ${topic.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
        <button
          type="button"
          className="dm-secondary curriculum-add"
          disabled={topics.length >= 50}
          onClick={() =>
            setTopics((current) => [
              ...current,
              { id: crypto.randomUUID(), name: "", active: true }
            ])
          }
        >
          <Plus size={17} /> Add lesson topic
        </button>
        <Field label="Reason for changing lesson topics" name="reason" />
        {pending(target) && <p>Lesson-topic changes are waiting to be sent.</p>}
      </EntryForm>
    </details>
  );
}
