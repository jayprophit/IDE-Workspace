/* Task/Agent Center - objectives, tasks, workers, queue, dependencies.
 * Full task DAG with dependency tracking and failure recovery.
 * Mirrors task_dag.py DurableTaskGraph + WorkQueue + QueueDecisionEngine.
 * Connects to Agent Bridge runtime for live worker/task state.
 * 
 * DO NOT redesign from scratch - implement around owner-approved visual
 * references in IDE-WORKSPACE/references/visuals/
 */

import React, { useEffect, useState, useRef } from 'react';
import { fetchBridgeStatus } from '../bridge';

// Task status mapping (from task_dag.py TaskStatus enum)
export enum TaskStatus {
  PLANNED = "PLANNED",
  QUEUED = "QUEUED",
  RUNNING = "RUNNING",
  WAITING = "WAITING",
  BLOCKED = "BLOCKED",
  FAILED = "FAILED",
  RETRYING = "RETRYING",
  VERIFYING = "VERIFYING",
  COMPLETE = "COMPLETE",
  VERIFIED_COMPLETE = "VERIFIED_COMPLETE",
  CANCELLED = "CANCELLED",
}

// Task record interface (from task_dag.py TaskRecord)
export interface TaskRecord {
  task_id: string;
  parent_task: string;
  objective: string;
  requirements: string[];
  dependencies: string[];
  assigned_worker: string;
  execution_environment: string;
  status: TaskStatus;
  checkpoint: string;
  attempt: number;
  budget: {
    time_s: number;
    tool_calls: number;
    retries: number;
    cost_units: number;
  };
  started_at: number;
  updated_at: number;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  evidence: string[];
  failures: string[];
  next_action: string;
}

/* TaskCenter component - objectives, tasks, workers, queue, dependencies */
export function TaskCenter({ baseUrl = 'http://127.0.0.1:8471' }: { baseUrl?: string }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!mountedRef.current) return;

    async function refresh() {
      try {
        setLoading(true);
        setError(null);
        const status = await fetchBridgeStatus(baseUrl);

        if (cancelled) return;
        if (!status.connected) {
          setTasks([]);
          setLoading(false);
          return;
        }

        // Extract task data from runtime snapshot
        const runtime = status.runtime;
        if (runtime && runtime.tasks) {
          // Map runtime tasks to our TaskRecord interface
          const taskRecords: TaskRecord[] = runtime.tasks.map((t: any) => ({
            task_id: t.task_id || '',
            parent_task: t.parent_task || '',
            objective: t.objective || 'No objective',
            requirements: t.requirements || [],
            dependencies: t.dependencies || [],
            assigned_worker: t.assigned_worker || '',
            execution_environment: t.execution_environment || '',
            status: Object.values(TaskStatus).find(s => s === t.status) || TaskStatus.PLANNED,
            checkpoint: t.checkpoint || '',
            attempt: t.attempt || 0,
            budget: t.budget || {
              time_s: 0,
              tool_calls: 0,
              retries: 2,
              cost_units: 0,
            },
            started_at: t.started_at || 0,
            updated_at: t.updated_at || 0,
            inputs: t.inputs || {},
            outputs: t.outputs || {},
            evidence: t.evidence || [],
            failures: t.failures || [],
            next_action: t.next_action || '',
          }));
          setTasks(taskRecords);
        } else {
          setTasks([]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();

    // Poll for updates
    const interval = setInterval(refresh, 3000);
    return () => {
      mountedRef.current = false;
      cancelled = true;
      clearInterval(interval);
    };
  }, [baseUrl]);

  const statusLabels: Record<TaskStatus, string> = {
    [TaskStatus.PLANNED]: 'Planned',
    [TaskStatus.QUEUED]: 'Queued',
    [TaskStatus.RUNNING]: 'Running',
    [TaskStatus.WAITING]: 'Waiting',
    [TaskStatus.BLOCKED]: 'Blocked',
    [TaskStatus.FAILED]: 'Failed',
    [TaskStatus.RETRYING]: 'Retrying',
    [TaskStatus.VERIFYING]: 'Verifying',
    [TaskStatus.COMPLETE]: 'Complete',
    [TaskStatus.VERIFIED_COMPLETE]: 'Verified Complete',
    [TaskStatus.CANCELLED]: 'Cancelled',
  };

  if (loading) {
    return <div>Loading task state...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div className="task-center">
      <h3>Task / Agent Center</h3>

      <div className="task-summary">
        <span>Total tasks: {tasks.length}</span>
        <span>Running: {tasks.filter(t => t.status === TaskStatus.RUNNING).length}</span>
        <span>Queued: {tasks.filter(t => t.status === TaskStatus.QUEUED).length}</span>
        <span>Blocked: {tasks.filter(t => t.status === TaskStatus.BLOCKED).length}</span>
      </div>

      {tasks.length === 0 && <p>No active tasks. Submit an objective to get started.</p>}

      <div className="task-list">
        {tasks.map((task) => (
          <div key={task.task_id} className="task-item">
            <div className="task-header">
              <span className="task-status">{statusLabels[task.status]}</span>
              <span className="task-id">#{task.task_id}</span>
            </div>
            <div className="task-objective">
              <strong>Objective:</strong> {task.objective}
            </div>
            <div className="task-actions">
              <span>Dependencies: {task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}</span>
              <span>Worker: {task.assigned_worker || 'unassigned'}</span>
              <span>Attempt: {task.attempt}</span>
            </div>
            <div className="task-next-action">
              Next: {task.next_action || 'none'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Shared cancellation flag for the refresh effect above. */
let cancelled = false;

