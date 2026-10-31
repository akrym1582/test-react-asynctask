// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskStore } from '../src/taskStore';
import { AsyncTasksProvider, useAsyncTasks } from '../src/AsyncTasksContext';
import { useAfterTasks } from '../src/useAfterTasks';
import { ExampleForm } from '../src/ExampleForm';

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('task store', () => {
  it('waits for tasks added while waiting', async () => {
    const store = createTaskStore();
    const first = deferred<void>(); const second = deferred<void>();
    store.register(first.promise);
    let finished = false;
    const waiting = store.wait().then(() => { finished = true; });
    store.register(second.promise);
    first.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    second.resolve(); await waiting;
    expect(finished).toBe(true);
  });
  it('retains errors until the same field succeeds', async () => {
    const store = createTaskStore();
    store.register(Promise.reject(new Error('invalid')), 'name');
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    await expect(store.wait()).rejects.toBeInstanceOf(AggregateError);
    store.register(Promise.resolve(), 'name');
    await expect(store.wait()).resolves.toBeUndefined();
  });
  it('locks actions within the scope and ignores stale releases', () => {
    const store = createTaskStore();
    const release = store.tryAcquire()!;
    expect(store.tryAcquire()).toBeNull(); release();
    const release2 = store.tryAcquire()!;
    release(); expect(store.getBusy()).toBe(true);
    release2(); expect(store.getBusy()).toBe(false);
  });
});

function Harness({ task, action, onError }: {
  task: Promise<string>; action: (value: string) => Promise<void> | void;
  onError: (error: unknown) => void;
}) {
  const [value, setValue] = useState('old');
  const { register } = useAsyncTasks();
  const { run, busy } = useAfterTasks(() => action(value), { onError });
  return <>
    <button onClick={() => register(task.then(setValue), 'value')}>blur</button>
    <button onClick={run} disabled={busy}>save</button>
    <output>{value}</output>
  </>;
}
function setup(task: Promise<string>, action = vi.fn(), onError = vi.fn()) {
  const view = render(<StrictMode><AsyncTasksProvider>
    <Harness task={task} action={action} onError={onError} />
  </AsyncTasksProvider></StrictMode>);
  return { ...view, action, onError };
}

describe('useAfterTasks', () => {
  it('invokes the new render callback once, and stays busy until action completes', async () => {
    const input = deferred<string>(); const saving = deferred<void>();
    const action = vi.fn(() => saving.promise);
    setup(input.promise, action);
    fireEvent.click(screen.getByText('blur'));
    fireEvent.click(screen.getByText('save'));
    fireEvent.click(screen.getByText('save'));
    expect(action).not.toHaveBeenCalled();
    await act(async () => { input.resolve('new'); });
    await waitFor(() => expect(action).toHaveBeenCalledExactlyOnceWith('new'));
    expect((screen.getByText('save') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { saving.resolve(); });
    await waitFor(() => expect((screen.getByText('save') as HTMLButtonElement).disabled).toBe(false));
  });
  it('does not execute after a task fails', async () => {
    const task = deferred<string>(); const { action, onError } = setup(task.promise);
    fireEvent.click(screen.getByText('blur')); fireEvent.click(screen.getByText('save'));
    await act(async () => { task.reject(new Error('failed')); });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(action).not.toHaveBeenCalled();
  });
  it('cancels a pending action on unmount', async () => {
    const task = deferred<string>(); const { action, unmount } = setup(task.promise);
    fireEvent.click(screen.getByText('blur')); fireEvent.click(screen.getByText('save'));
    unmount();
    await act(async () => { task.resolve('new'); });
    expect(action).not.toHaveBeenCalled();
  });
  it('reports action failures and releases busy', async () => {
    const action = vi.fn(async () => { throw new Error('save failed'); });
    const { onError } = setup(Promise.resolve('unused'), action);
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((screen.getByText('save') as HTMLButtonElement).disabled).toBe(false);
  });
  it('forces focused input blur on submit, then saves normalized values', async () => {
    const task = deferred<string>(); const save = vi.fn(async () => {});
    render(<StrictMode><ExampleForm normalizeName={() => task.promise}
      normalizeAddress={async value => value} save={save} /></StrictMode>);
    const input = screen.getByLabelText('氏名');
    fireEvent.change(input, { target: { value: ' raw ' } });
    input.focus();
    fireEvent.submit(input.closest('form')!);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { task.resolve('normalized'); });
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'normalized', address: '' }));
  });
});
