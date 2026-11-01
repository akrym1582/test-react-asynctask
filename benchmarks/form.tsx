import { memo, useCallback, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  AfterTasksProvider,
  useAfterTasks,
  type AfterTasksStore,
} from "../src/AfterTasks";
import { createAfterTasksFieldStore } from "../src/afterTasksFieldStore";
import { useAfterTasksField } from "../src/useAfterTasksField";

export type Scenario =
  "register" | "blur-all" | "blur-one" | "save-dirty" | "state-one";
export type Measurement = {
  size: number;
  scenario: Scenario;
  startMs: number;
  registerMs: number;
  editMs: number;
  blurMs: number;
  waitMs: number;
  totalMs: number;
  notifications: number;
  fieldCommits: number[];
  formCommits: number;
  savedLatest: boolean;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** 同じ実装をjsdomと実ブラウザーで実行。通信待ち時間は外し、非同期境界だけ残します。 */
export async function measureForm(
  size: number,
  scenario: Scenario,
): Promise<Measurement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const gate = deferred();
  const result: Measurement = {
    size,
    scenario,
    startMs: 0,
    registerMs: 0,
    editMs: 0,
    blurMs: 0,
    waitMs: 0,
    totalMs: 0,
    notifications: 0,
    fieldCommits: Array(size).fill(0),
    formCommits: 0,
    savedLatest: false,
  };
  let store!: AfterTasksStore;
  let run!: () => void;
  let update!: (index: number, value: string) => void;
  const fields: ReturnType<typeof useAfterTasksField>[] = [];
  let instrumented = false;
  let measuring = false;
  let saveError: unknown;
  let actionCalled = false;

  // テスト専用の購読ラッパー。通知「回数」は全購読者への配信回数の合計です。
  // 内部waitの直接listenerを除き、共有状態・入力key・汎用購読を合計します。
  function Probe() {
    store = useAfterTasks();
    if (!instrumented) {
      const count = (listener: () => void) => () => {
        if (measuring) result.notifications++;
        listener();
      };
      const subscribe = store.subscribe;
      store.subscribe = (listener) => subscribe(count(listener));
      const snapshotSubscribe = store.subscribeSnapshot;
      store.subscribeSnapshot = (listener) =>
        snapshotSubscribe(count(listener));
      const fieldStore = createAfterTasksFieldStore(store);
      const fieldSubscribe = fieldStore.subscribe;
      fieldStore.subscribe = (key, listener) =>
        fieldSubscribe(key, count(listener));
      instrumented = true;
    }
    return null;
  }
  const Field = memo(function Field({
    index,
    value,
    onValue,
  }: {
    index: number;
    value: string;
    onValue: (index: number, value: string) => void;
  }) {
    const field = useAfterTasksField({
      taskKey: String(index),
      value,
      normalize: async (input) => {
        await gate.promise;
        return input.toUpperCase();
      },
      onCommit: (next) => onValue(index, next),
    });
    useLayoutEffect(() => {
      fields[index] = field;
      result.fieldCommits[index]++;
    });
    return (
      <input
        aria-label={`項目${index}`}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          field.change(next);
          onValue(index, next);
        }}
        onBlur={field.commit}
      />
    );
  });
  function Form() {
    const [values, setValues] = useState(() => Array<string>(size).fill(""));
    const onValue = useCallback((index: number, next: string) => {
      setValues((current) =>
        current.map((value, i) => (i === index ? next : value)),
      );
    }, []);
    const execution = useAfterTasks(
      () => {
        actionCalled = true;
        result.savedLatest = values.every(
          (value, index) =>
            value ===
            (scenario === "register"
              ? ""
              : scenario === "save-dirty" ||
                  scenario === "blur-all" ||
                  index === 0
                ? "X"
                : ""),
        );
      },
      {
        onError: (error) => {
          saveError = error;
        },
      },
    );
    useLayoutEffect(() => {
      run = execution.runAfterTasks;
      update = onValue;
      result.formCommits++;
    });
    return (
      <>
        {values.map((value, index) => (
          <Field key={index} index={index} value={value} onValue={onValue} />
        ))}
        <button onClick={execution.runAfterTasks}>保存</button>
      </>
    );
  }
  // effectの購読設定まで完了させてから計測します。mount/unmountは測定外です。
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  try {
    flushSync(() =>
      root.render(
        <AfterTasksProvider>
          <Probe />
          <Form />
        </AfterTasksProvider>,
      ),
    );
    await settle();
    result.notifications = 0;
    result.fieldCommits.fill(0);
    result.formCommits = 0;
    measuring = true;
    const started = performance.now();
    if (scenario === "register") {
      flushSync(() => {
        for (let i = 0; i < size; i++)
          void store.registerAsyncTask(() => gate.promise);
      });
      result.registerMs = performance.now() - started;
    } else if (scenario === "state-one") {
      flushSync(() => update(0, "x"));
      result.editMs = performance.now() - started;
    } else {
      const count = scenario === "blur-one" ? 1 : size;
      flushSync(() => {
        for (let i = 0; i < count; i++) {
          fields[i].change("x");
          update(i, "x");
        }
      });
      result.editMs = performance.now() - started;
      const blurStarted = performance.now();
      const inputs = host.querySelectorAll("input");
      if (scenario === "save-dirty") flushSync(run);
      else
        flushSync(() => {
          for (let i = 0; i < count; i++) {
            const input = inputs[i];
            input.focus();
            input.blur();
          }
        });
      result.blurMs = performance.now() - blurStarted;
    }
    result.startMs = performance.now() - started;
    const waitStarted = performance.now();
    gate.resolve();
    // 保存actionの完了まで待ちます。runAfterTasksのvoid戻り値をawaitしません。
    if (scenario !== "save-dirty" && scenario !== "state-one") flushSync(run);
    const deadline = performance.now() + 10000;
    while (store.hasPendingTasks || store.isRunning) {
      if (performance.now() > deadline)
        throw new Error("ベンチマークの保存が完了しません");
      await settle();
    }
    await settle();
    result.waitMs = performance.now() - waitStarted;
    result.totalMs = performance.now() - started;
    if (saveError) throw saveError;
    if (scenario === "state-one") result.savedLatest = true;
    else if (!actionCalled) throw new Error("保存actionが呼ばれていません");
    return result;
  } finally {
    measuring = false;
    gate.resolve();
    flushSync(() => root.unmount());
    host.remove();
  }
}
