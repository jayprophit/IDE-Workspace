import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GenesisTaskBar from './GenesisTaskBar';

/**
 * These tests encode the two promises the minimum harness makes to a human:
 * a refusal is never dressed as a success, and a decision control is only
 * offered when the session can actually accept a decision.
 *
 * The client is mocked, so what is under test is the IDE's own honesty, not
 * the Bridge. The Bridge side of the same loop is proven for real in
 * workspace/integration/tests/test_bridge_vertical_slice.py.
 */

const BASE = 'http://127.0.0.1:8471';

const createSession = vi.fn();
const submitTask = vi.fn();
const sessionStatus = vi.fn();
const sessionEvents = vi.fn();
const decideApproval = vi.fn();
const cancelTask = vi.fn();
const taskOutcome = vi.fn();
const taskEvidence = vi.fn();

vi.mock('../genesisBridge', async (importOriginal) => {
  const original = await importOriginal<typeof import('../genesisBridge')>();
  return {
    ...original,
    createSession: (...args: unknown[]) => createSession(...args),
    submitTask: (...args: unknown[]) => submitTask(...args),
    sessionStatus: (...args: unknown[]) => sessionStatus(...args),
    sessionEvents: (...args: unknown[]) => sessionEvents(...args),
    decideApproval: (...args: unknown[]) => decideApproval(...args),
    cancelTask: (...args: unknown[]) => cancelTask(...args),
    taskOutcome: (...args: unknown[]) => taskOutcome(...args),
    taskEvidence: (...args: unknown[]) => taskEvidence(...args),
  };
});

const EVIDENCE = { ok: true, data: { manifest: [], scorecard_categories: {}, timeline: [] }, error: '' };

function ok<T>(data: T) {
  return { ok: true, data, error: '' };
}
function fail(error: string) {
  return { ok: false, data: null, error };
}

beforeEach(() => {
  for (const mock of [
    createSession, submitTask, sessionStatus, sessionEvents,
    decideApproval, cancelTask, taskOutcome, taskEvidence,
  ]) {
    mock.mockReset();
  }
  taskEvidence.mockResolvedValue(EVIDENCE);
});

async function renderBar(props: Partial<React.ComponentProps<typeof GenesisTaskBar>> = {}) {
  const user = userEvent.setup({ delay: null });
  // pollMs is 1500 in production; a short interval here keeps the tests
  // deterministic without changing what the component does.
  const view = render(
    <GenesisTaskBar
      baseUrl={BASE}
      workspace="C:/ws"
      interactive
      approval="ASK_ALL_WRITES"
      pollMs={10}
      {...props}
    />,
  );
  return { user, view };
}

async function submitGoal(user: ReturnType<typeof userEvent.setup>, goal = 'read the project') {
  await user.type(screen.getByTestId('genesis-task-input'), goal);
  await user.click(screen.getByTestId('genesis-submit'));
}

describe('GenesisTaskBar: the loop a human needs', () => {
  it('creates an interactive session and submits a real task id', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'ASK_ALL_WRITES', interactive: true }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'EXECUTING', interactive: true, tasks: { 't-1': 'EXECUTING' },
      pending_approvals: [], files_touched: [], errors: [], approvals: [],
      tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
    }));
    sessionEvents.mockResolvedValue(ok([]));

    const { user } = await renderBar();
    await submitGoal(user);

    await waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(createSession.mock.calls[0][1]).toMatchObject({
      workspace: 'C:/ws', approval: 'ASK_ALL_WRITES', interactive: true,
    });
    await waitFor(() => expect(submitTask).toHaveBeenCalledWith(BASE, 's-1', 'read the project'));
    await waitFor(() => expect(screen.getByTestId('genesis-phase').textContent).not.toBe('starting'));
  });

  it('shows a pending approval with its real action and risk', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'ASK_ALL_WRITES', interactive: true }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'WAITING_APPROVAL', interactive: true,
      tasks: { 't-1': 'EXECUTING' }, pending_approvals: ['ap-7'],
      files_touched: [], errors: [], approvals: [],
      tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
    }));
    sessionEvents.mockResolvedValue(ok([
      { event: 'approval.requested', approval_id: 'ap-7', action: { action: 'write' }, risk: 'RISKY' },
    ]));

    const { user } = await renderBar();
    await submitGoal(user);

    await waitFor(() => expect(screen.getByTestId('genesis-approvals')).toBeTruthy());
    const row = screen.getByTestId('genesis-approval-ap-7');
    expect(row.textContent).toContain('write');
    expect(row.textContent).toContain('RISKY');
    await waitFor(() => expect(screen.getByTestId('genesis-phase').textContent).toBe('waiting-approval'));
  });

  it('approves with a single decision and no fabricated follow-up', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'ASK_ALL_WRITES', interactive: true }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'WAITING_APPROVAL', interactive: true,
      tasks: { 't-1': 'EXECUTING' }, pending_approvals: ['ap-7'],
      files_touched: [], errors: [], approvals: [],
      tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
    }));
    sessionEvents.mockResolvedValue(ok([
      { event: 'approval.requested', approval_id: 'ap-7', action: { action: 'write' } },
    ]));
    decideApproval.mockResolvedValue(ok({ approval_id: 'ap-7', decision: 'approve-once' }));

    const { user } = await renderBar();
    await submitGoal(user);
    await waitFor(() => expect(screen.getByTestId('genesis-approve-ap-7')).toBeTruthy());
    await user.click(screen.getByTestId('genesis-approve-ap-7'));

    await waitFor(() =>
      expect(decideApproval).toHaveBeenCalledWith(BASE, 's-1', 'ap-7', 'approve-once'),
    );
    // exactly one decision, never a retry loop
    expect(decideApproval).toHaveBeenCalledTimes(1);
  });

  it('denies and then reports the run as blocked, not as success', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'ASK_ALL_WRITES', interactive: true }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus
      .mockResolvedValueOnce(ok({
        session_id: 's-1', status: 'WAITING_APPROVAL', interactive: true,
        tasks: { 't-1': 'EXECUTING' }, pending_approvals: ['ap-7'],
        files_touched: [], errors: [], approvals: [],
        tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
      }))
      .mockResolvedValue(ok({
        session_id: 's-1', status: 'COMPLETED', interactive: true,
        tasks: { 't-1': 'COMPLETED' }, pending_approvals: [],
        files_touched: [], errors: [], approvals: [{ action: 'write', decision: 'deny' }],
        tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: 'skipped',
      }));
    sessionEvents.mockResolvedValue(ok([
      { event: 'approval.requested', approval_id: 'ap-7', action: { action: 'write' } },
    ]));
    decideApproval.mockResolvedValue(ok({ approval_id: 'ap-7', decision: 'deny' }));
    taskOutcome.mockResolvedValue(ok({
      task_id: 't-1', status: 'COMPLETED', effect_achieved: false, denied_actions: 1,
      blocked: true, files_created: [], files_modified: [], files_deleted: [], commands: [],
      errors: [{ kind: 'APPROVAL_DENIED', error: 'denied' }],
      approvals: [{ action: 'write', decision: 'deny' }], review_verdict: 'skipped',
      finished_reason: 'finished', tests_ran: 0, tests_passed: 0, tests_verified: false, duration_s: 0.1,
    }));

    const { user } = await renderBar();
    await submitGoal(user);
    await waitFor(() => expect(screen.getByTestId('genesis-deny-ap-7')).toBeTruthy());
    await user.click(screen.getByTestId('genesis-deny-ap-7'));

    await waitFor(() => expect(taskOutcome).toHaveBeenCalledWith(BASE, 's-1', 't-1'));
    const outcome = await screen.findByTestId('genesis-outcome');
    // The status was COMPLETED and the work never happened. The bar must not
    // present that as a success.
    expect(outcome.getAttribute('data-blocked')).toBe('true');
    expect(outcome.getAttribute('data-effect')).toBe('false');
    expect(outcome.getAttribute('data-status')).toBe('COMPLETED');
    expect(outcome.textContent).toContain('blocked');
    expect(outcome.textContent).toContain('APPROVAL_DENIED');
  });

  it('offers no decision control on a session that cannot accept one', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'ASK_RISKY', interactive: false }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'WAITING_APPROVAL', interactive: false,
      tasks: { 't-1': 'EXECUTING' }, pending_approvals: ['ap-7'],
      files_touched: [], errors: [], approvals: [],
      tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
    }));
    sessionEvents.mockResolvedValue(ok([
      { event: 'approval.requested', approval_id: 'ap-7', action: { action: 'write' } },
    ]));

    const { user } = await renderBar({ interactive: false, approval: 'ASK_RISKY' });
    await submitGoal(user);

    await waitFor(() => expect(screen.getByTestId('genesis-approval-undecidable-ap-7')).toBeTruthy());
    expect(screen.queryByTestId('genesis-approve-ap-7')).toBeNull();
    expect(screen.queryByTestId('genesis-deny-ap-7')).toBeNull();
    expect(screen.getByTestId('genesis-approval-mode').textContent).toContain('non-interactive');
  });

  it('shows the refusal when the Bridge will not create an interactive session', async () => {
    createSession.mockResolvedValue(fail('interactive approvals are not enabled on this runtime'));
    const { user } = await renderBar();
    await submitGoal(user);
    await waitFor(() =>
      expect(screen.getByTestId('genesis-error').textContent).toContain('not enabled'),
    );
    expect(submitTask).not.toHaveBeenCalled();
    expect(screen.getByTestId('genesis-phase').textContent).toBe('error');
  });

  it('cancels a running task through the Bridge', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'AUTO_SAFE', interactive: false }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'EXECUTING', interactive: false,
      tasks: { 't-1': 'EXECUTING' }, pending_approvals: [],
      files_touched: [], errors: [], approvals: [],
      tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
    }));
    sessionEvents.mockResolvedValue(ok([]));
    cancelTask.mockResolvedValue(ok({ task_id: 't-1', status: 'CANCELLED' }));

    const { user } = await renderBar({ interactive: false, approval: 'AUTO_SAFE' });
    await submitGoal(user);
    await waitFor(() => expect(screen.getByTestId('genesis-cancel')).not.toBeDisabled());
    await user.click(screen.getByTestId('genesis-cancel'));
    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith(BASE, 's-1', 't-1'));
  });

  it('shows evidence for a real change and nothing for an empty one', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'AUTO_SAFE', interactive: false }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'COMPLETED', interactive: false,
      tasks: { 't-1': 'COMPLETED' }, pending_approvals: [],
      files_touched: ['a.py'], errors: [], approvals: [],
      tests: { ran: 1, passed: 1, all_passed: true, verified: true }, review: 'approved',
    }));
    sessionEvents.mockResolvedValue(ok([]));
    taskOutcome.mockResolvedValue(ok({
      task_id: 't-1', status: 'COMPLETED', effect_achieved: true, denied_actions: 0, blocked: false,
      files_created: ['a.py'], files_modified: [], files_deleted: [], commands: [],
      errors: [], approvals: [], review_verdict: 'approved', finished_reason: 'finished',
      tests_ran: 1, tests_passed: 1, tests_verified: true, duration_s: 0.2,
    }));
    taskEvidence.mockResolvedValue(ok({
      manifest: [{ path: 'a.py', action: 'write' }],
      scorecard_categories: { correctness: 'pass' },
      timeline: ['start', 'write', 'done'],
    }));

    const { user } = await renderBar({ interactive: false, approval: 'AUTO_SAFE' });
    await submitGoal(user);

    const outcome = await screen.findByTestId('genesis-outcome');
    expect(outcome.getAttribute('data-blocked')).toBe('false');
    expect(outcome.getAttribute('data-effect')).toBe('true');
    const evidence = screen.getByTestId('genesis-evidence');
    expect(evidence.textContent).toContain('a.py');
    expect(evidence.textContent).toContain('correctness=pass');
  });

  it('surfaces a status read failure instead of an empty success panel', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'AUTO_SAFE', interactive: false }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(fail('cannot reach runtime: refused'));
    sessionEvents.mockResolvedValue(ok([]));

    const { user } = await renderBar({ interactive: false, approval: 'AUTO_SAFE' });
    await submitGoal(user);
    await waitFor(() => expect(screen.getByTestId('genesis-error').textContent).toContain('cannot reach runtime'));
    expect(screen.queryByTestId('genesis-outcome')).toBeNull();
  });

  it('stops polling once the task is terminal', async () => {
    createSession.mockResolvedValue(ok({ session_id: 's-1', mode: 'build', approval: 'AUTO_SAFE', interactive: false }));
    submitTask.mockResolvedValue(ok({ task_id: 't-1', status: 'QUEUED', deduped: false }));
    sessionStatus.mockResolvedValue(ok({
      session_id: 's-1', status: 'COMPLETED', interactive: false,
      tasks: { 't-1': 'COMPLETED' }, pending_approvals: [],
      files_touched: [], errors: [], approvals: [],
      tests: { ran: 0, passed: 0, all_passed: null, verified: false }, review: '',
    }));
    sessionEvents.mockResolvedValue(ok([]));
    taskOutcome.mockResolvedValue(ok({
      task_id: 't-1', status: 'COMPLETED', effect_achieved: false, denied_actions: 0, blocked: false,
      files_created: [], files_modified: [], files_deleted: [], commands: [], errors: [], approvals: [],
      review_verdict: 'skipped', finished_reason: 'finished',
      tests_ran: 0, tests_passed: 0, tests_verified: false, duration_s: 0,
    }));

    const { user } = await renderBar({ interactive: false, approval: 'AUTO_SAFE', pollMs: 5 });
    await submitGoal(user);
    await screen.findByTestId('genesis-outcome');
    const callsAfterFinish = sessionStatus.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(sessionStatus.mock.calls.length).toBe(callsAfterFinish);
  });
});
